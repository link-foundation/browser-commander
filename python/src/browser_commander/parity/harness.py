"""Parity harness: capture the environment probe and diff two captures.

The reference capture never speaks CDP. The browser is started as a plain
child process pointed at a local page; the page runs the probe and POSTs the
JSON report back. That is the only way to get a baseline that is genuinely "a
real browser" rather than "a browser we are already driving". Automated
captures are delivered the same way, so a difference in the diff is a
difference in the browser rather than in how the probe was invoked.
"""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import json
import os
import re
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

from browser_commander.browser.profile_directory import (
    create_temporary_user_data_dir,
    remove_user_data_dir,
)
from browser_commander.utilities.subprocess import start_process

__all__ = [
    "IGNORED_PATHS",
    "PROBE_SOURCE_PATH",
    "ProbeReport",
    "ProbeServer",
    "build_reference_args",
    "capture_reference_report",
    "diff_reports",
    "probe_expression",
    "read_probe_source",
    "start_probe_server",
]

#: The environment probe shipped with the package (byte-identical to the
#: JavaScript package's ``src/parity/probe.js``).
PROBE_SOURCE_PATH = Path(__file__).with_name("probe.js")

_STDERR_TAIL_CHARS = 4000
_MAX_HEADER_BYTES = 64 * 1024


async def read_probe_source() -> str:
    """Read the environment probe shipped with the package."""

    return await asyncio.to_thread(PROBE_SOURCE_PATH.read_text, encoding="utf-8")


def probe_expression(source: str) -> str:
    """Wrap the probe source as an immediately invoked expression."""

    return f"({source})()"


def _probe_page(probe_source: str, token: str) -> str:
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>probe</title></head>
<body><p id="status">running</p>
<script>
{probe_expression(probe_source)}
  .then((report) => fetch('/report/{token}', {{
    method: 'POST',
    headers: {{ 'content-type': 'application/json' }},
    body: JSON.stringify(report),
  }}))
  .then(() => {{ document.getElementById('status').textContent = 'done'; }})
  .catch((error) => fetch('/report/{token}', {{
    method: 'POST',
    headers: {{ 'content-type': 'application/json' }},
    body: JSON.stringify({{ fatal: String(error && error.stack || error) }}),
  }}));
</script></body></html>"""


class ProbeReport(dict):  # type: ignore[type-arg]
    """A probe report (a plain ``dict``) with the reference ``command_line``.

    ``command_line`` is an attribute rather than a key, so the report still
    serializes exactly like the JavaScript one (where it is non-enumerable).
    """

    command_line: list[str]


class ProbeServer:
    """Serve the probe page and collect the reports page scripts POST back.

    Use :func:`start_probe_server` to create one.
    """

    def __init__(self, probe_source: str) -> None:
        self._probe_source = probe_source
        self._reports: dict[str, Any] = {}
        self._waiters: dict[str, asyncio.Future[Any]] = {}
        # Accept-Language and Sec-CH-UA-* are part of the fingerprint and are
        # only observable server-side, so they are recorded per token.
        self._request_headers: dict[str, dict[str, str]] = {}
        self._server: asyncio.AbstractServer | None = None
        self._connections: set[asyncio.StreamWriter] = set()
        self.port = 0

    async def start(self) -> ProbeServer:
        self._server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        self.port = int(self._server.sockets[0].getsockname()[1])
        return self

    def url(self, token: str) -> str:
        """The probe page URL for ``token``."""

        return f"http://127.0.0.1:{self.port}/probe/{token}"

    def headers_for(self, token: str) -> dict[str, str] | None:
        """Request headers of the probe page load for ``token`` (lower-case)."""

        return self._request_headers.get(token)

    async def wait_for_report(self, token: str, timeout_ms: float = 60000) -> Any:
        """Wait for the report POSTed for ``token``.

        Raises:
            TimeoutError: ``timed out waiting for report <token>``.
        """

        if token in self._reports:
            return self._reports[token]
        future = self._waiters.get(token)
        if future is None:
            future = asyncio.get_running_loop().create_future()
            self._waiters[token] = future
        try:
            return await asyncio.wait_for(asyncio.shield(future), timeout_ms / 1000)
        except asyncio.TimeoutError:
            msg = f"timed out waiting for report {token}"
            raise TimeoutError(msg) from None

    async def close(self) -> None:
        """Stop listening and drop every open connection."""

        for writer in list(self._connections):
            with contextlib.suppress(Exception):
                writer.close()
        if self._server is not None:
            self._server.close()
            with contextlib.suppress(Exception):
                await self._server.wait_closed()
        for future in self._waiters.values():
            if not future.done():
                future.cancel()

    def _deliver(self, token: str, report: Any) -> None:
        self._reports[token] = report
        future = self._waiters.pop(token, None)
        if future is not None and not future.done():
            future.set_result(report)

    async def _handle(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        self._connections.add(writer)
        try:
            await self._serve(reader, writer)
        except (OSError, ValueError, asyncio.IncompleteReadError):
            pass
        finally:
            self._connections.discard(writer)
            with contextlib.suppress(Exception):
                writer.close()

    async def _serve(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        head = await reader.readuntil(b"\r\n\r\n")
        if len(head) > _MAX_HEADER_BYTES:
            await self._respond(writer, 431)
            return
        lines = head.decode("latin-1").split("\r\n")
        method, target, *_ = [*lines[0].split(" "), "", ""]
        headers: dict[str, str] = {}
        for line in lines[1:]:
            name, separator, value = line.partition(":")
            if not separator:
                continue
            key = name.strip().lower()
            value = value.strip()
            headers[key] = f"{headers[key]}, {value}" if key in headers else value
        path = urlsplit(target).path
        if method == "GET" and path.startswith("/probe/"):
            token = path[len("/probe/") :]
            self._request_headers[token] = dict(headers)
            await self._respond(
                writer,
                200,
                _probe_page(self._probe_source, token).encode("utf-8"),
                "text/html; charset=utf-8",
            )
            return
        if method == "POST" and path.startswith("/report/"):
            body = await _read_body(reader, headers)
            report = json.loads(body.decode("utf-8"))
            self._deliver(path[len("/report/") :], report)
            await self._respond(writer, 204)
            return
        await self._respond(writer, 404)

    @staticmethod
    async def _respond(
        writer: asyncio.StreamWriter,
        status: int,
        body: bytes = b"",
        content_type: str | None = None,
    ) -> None:
        reasons = {200: "OK", 204: "No Content", 404: "Not Found", 431: "Too Large"}
        lines = [f"HTTP/1.1 {status} {reasons.get(status, 'OK')}"]
        if content_type:
            lines.append(f"Content-Type: {content_type}")
        if status != 204:
            lines.append(f"Content-Length: {len(body)}")
        lines.append("Connection: close")
        writer.write(("\r\n".join(lines) + "\r\n\r\n").encode("latin-1") + body)
        await writer.drain()


async def _read_body(reader: asyncio.StreamReader, headers: Mapping[str, str]) -> bytes:
    if "chunked" in headers.get("transfer-encoding", "").lower():
        chunks: list[bytes] = []
        while True:
            size_line = await reader.readuntil(b"\r\n")
            size = int(size_line.split(b";", 1)[0].strip() or b"0", 16)
            if size == 0:
                await reader.readuntil(b"\r\n")
                return b"".join(chunks)
            chunks.append(await reader.readexactly(size))
            await reader.readexactly(2)
    length = int(headers.get("content-length", "0") or "0")
    return await reader.readexactly(length) if length > 0 else b""


async def start_probe_server(probe_source: str) -> ProbeServer:
    """Serve the probe page on ``127.0.0.1`` and collect POSTed reports."""

    return await ProbeServer(probe_source).start()


def build_reference_args(
    *,
    user_data_dir: str,
    url: str,
    headless: bool = False,
    extra_args: Sequence[str] = (),
) -> list[str]:
    """The command line a person types: a profile, headless when asked, a URL."""

    return [
        f"--user-data-dir={user_data_dir}",
        *(["--headless=new"] if headless else []),
        *extra_args,
        url,
    ]


def _collect_tail(channel: Any) -> Callable[[], str]:
    """Keep the last few kilobytes a process wrote, for error messages."""

    tail = ""

    def listen(chunk: Any) -> None:
        nonlocal tail
        tail = (tail + str(chunk))[-_STDERR_TAIL_CHARS:]

    on = getattr(channel, "on", None)
    if callable(on):
        on("data", listen)
    return lambda: tail.strip()


def _with_output(message: str, output: str) -> str:
    return f"{message}\nbrowser stderr:\n{output}" if output else message


async def _maybe_await(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


async def _wait_exit(child: Any) -> int:
    wait = getattr(child, "wait", None)
    if callable(wait):
        return int(await _maybe_await(wait()))
    return int(await child.exited)


async def _exited_before_report(
    child: Any, executable_path: str, stderr: Callable[[], str]
) -> Any:
    """Fail as soon as the browser exits without reporting.

    A clean exit never settles: a launcher script may hand off to a browser
    that keeps running and still reports.
    """

    # Shielded: cancelling this race must not cancel the process's own exit
    # future, which the cleanup still waits on after kill().
    code = await asyncio.shield(_wait_exit(child))
    if code == 0:
        await asyncio.get_running_loop().create_future()
    msg = _with_output(
        f"reference browser {executable_path} exited with code {code} before reporting",
        stderr(),
    )
    raise RuntimeError(msg)


async def _report_or_output(
    server: Any, token: str, timeout_ms: float, stderr: Callable[[], str]
) -> Any:
    try:
        return await _maybe_await(server.wait_for_report(token, timeout_ms))
    except (TimeoutError, asyncio.TimeoutError) as error:
        raise TimeoutError(_with_output(str(error), stderr())) from error


async def capture_reference_report(
    *,
    server: Any,
    token: str,
    executable_path: str | None = None,
    extra_args: Sequence[str] = (),
    headless: bool = False,
    timeout_ms: float = 60000,
    start: Callable[..., Any] = start_process,
) -> ProbeReport:
    """Start the browser as a person would and collect its probe report.

    No CDP and no automation switches are involved. The profile is prepared
    like the launcher's temporary profile, so no first-run UI opens.

    Args:
        server: A :class:`ProbeServer` (or anything with ``url(token)`` and
            ``wait_for_report(token, timeout_ms)``).
        token: Unique token for this capture.
        executable_path: Browser binary; ``$CHROME_PATH`` or ``google-chrome``.
        extra_args: Extra switches after the profile.
        headless: Add ``--headless=new``.
        timeout_ms: How long to wait for the report.
        start: ``start(file, args, kill_grace=...)`` returning a process with
            ``stderr.on("data", ...)``, ``wait()`` and ``kill()``.

    Returns:
        The report, with the reference argv as ``report.command_line``.

    Raises:
        RuntimeError: The browser exited with a non-zero code before
            reporting; the message carries the code and the stderr tail.
        TimeoutError: No report arrived in time; the stderr tail is appended.
    """

    executable = executable_path or os.environ.get("CHROME_PATH") or "google-chrome"
    user_data_dir = await asyncio.to_thread(create_temporary_user_data_dir)
    args = build_reference_args(
        user_data_dir=user_data_dir,
        url=server.url(token),
        headless=headless,
        extra_args=extra_args,
    )
    try:
        child = await _maybe_await(start(executable, args, kill_grace=3.0))
    except BaseException:
        await asyncio.to_thread(remove_user_data_dir, user_data_dir)
        raise
    stderr = _collect_tail(getattr(child, "stderr", None))
    tasks: list[asyncio.Task[Any]] = [
        asyncio.ensure_future(_report_or_output(server, token, timeout_ms, stderr)),
        asyncio.ensure_future(_exited_before_report(child, executable, stderr)),
    ]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        report = next(iter(done)).result()
        result = ProbeReport(report if isinstance(report, Mapping) else {})
        result.command_line = args
        return result
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(BaseException):
                await task
        child.kill()
        with contextlib.suppress(Exception):
            await _wait_exit(child)
        await asyncio.to_thread(remove_user_data_dir, user_data_dir)


#: Probe paths that differ between two captures of the same real browser.
IGNORED_PATHS: tuple[re.Pattern[str], ...] = (
    # Window geometry depends on the window manager and on how each engine
    # sizes the first window; it is user-configurable.
    re.compile(
        r"^window\.(innerWidth|innerHeight|outerWidth|outerHeight|screenX|"
        r"screenY|screenLeft|screenTop)\Z"
    ),
    re.compile(r"^viewportRelation\."),
    re.compile(r"^document\.(referrer|hasFocus|bodyClientHeightIsPositive)\Z"),
    re.compile(r"^probeErrors\."),
    # NetworkInformation.downlink/rtt are rolling estimates.
    re.compile(r"^connection\.(downlink|rtt)\Z"),
)

_MISSING = object()


def _is_ignored(path: str, extra: Iterable[re.Pattern[str]]) -> bool:
    return any(pattern.search(path) for pattern in (*IGNORED_PATHS, *extra))


def _js_value(value: Any) -> Any:
    """Normalize a value so equality matches ``JSON.stringify`` equality."""

    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, Mapping):
        return {str(key): _js_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_js_value(item) for item in value]
    return value


def _serialized(value: Any) -> str | None:
    if value is _MISSING:
        return None
    return json.dumps(_js_value(value), separators=(",", ":"), ensure_ascii=False)


def diff_reports(
    reference: Any,
    candidate: Any,
    *,
    ignore: Iterable[re.Pattern[str] | str] = (),
) -> list[dict[str, Any]]:
    """Deep diff two probe reports into ``{path, reference, candidate}`` entries.

    Objects are walked key by key (sorted) so a difference names the exact
    field; arrays and scalars are compared whole. A key missing on one side is
    reported with ``None`` on that side.
    """

    extra = [re.compile(item) if isinstance(item, str) else item for item in ignore]
    differences: list[dict[str, Any]] = []

    def walk(left: Any, right: Any, trail: str) -> None:
        if _is_ignored(trail, extra):
            return
        if isinstance(left, Mapping) and isinstance(right, Mapping):
            for key in sorted({*map(str, left), *map(str, right)}):
                walk(
                    left.get(key, _MISSING),
                    right.get(key, _MISSING),
                    f"{trail}.{key}" if trail else key,
                )
            return
        if _serialized(left) != _serialized(right):
            differences.append(
                {
                    "path": trail,
                    "reference": None if left is _MISSING else left,
                    "candidate": None if right is _MISSING else right,
                }
            )

    walk(reference, candidate, "")
    return differences
