"""Unit tests for browser_commander.parity.harness (mirrors harness.test.js).

The reference capture starts a browser nothing automates and waits for the
probe page to POST its report. A browser that cannot start at all (no usable
sandbox, a rejected switch) never reports, so the capture has to fail with the
browser's own exit code and stderr rather than a bare 60 s timeout.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import pytest

from browser_commander.parity import (
    PROBE_SOURCE_PATH,
    ProbeReport,
    capture_reference_report,
    probe_expression,
    read_probe_source,
    start_probe_server,
)


class FakeProcess:
    """A browser stand-in: ``stderr.on``, ``wait()`` and ``kill()``."""

    def __init__(self, exit_code: int | None, stderr: str = "") -> None:
        loop = asyncio.get_running_loop()
        self._exited: asyncio.Future[int] = loop.create_future()
        self._listeners: list[Any] = []
        self.stderr = self
        self.killed = False
        loop.call_soon(self._emit, exit_code, stderr)

    def on(self, _event: str, listener: Any) -> None:
        self._listeners.append(listener)

    def _emit(self, exit_code: int | None, stderr: str) -> None:
        for listener in self._listeners:
            listener(stderr)
        if exit_code is not None:
            self._settle(exit_code)

    def _settle(self, code: int) -> None:
        if not self._exited.done():
            self._exited.set_result(code)

    def kill(self) -> None:
        self.killed = True
        self._settle(143)

    async def wait(self) -> int:
        return await self._exited


class FakeServer:
    def __init__(self, report: Any = None) -> None:
        self.report = report

    def url(self, token: str) -> str:
        return f"http://127.0.0.1:1/probe/{token}"

    async def wait_for_report(self, token: str, timeout_ms: float) -> Any:
        if self.report is not None:
            await asyncio.sleep(0.02)
            return self.report
        await asyncio.sleep(timeout_ms / 1000)
        msg = f"timed out waiting for report {token}"
        raise TimeoutError(msg)


async def test_fails_fast_with_the_exit_code_and_stderr_of_a_dead_browser() -> None:
    started = time.monotonic()
    processes: list[FakeProcess] = []

    def start(*_args: Any, **_options: Any) -> FakeProcess:
        processes.append(FakeProcess(1, "FATAL: No usable sandbox!"))
        return processes[-1]

    with pytest.raises(RuntimeError) as caught:
        await capture_reference_report(
            executable_path="/usr/bin/chromium",
            server=FakeServer(),
            token="t1",
            timeout_ms=3000,
            start=start,
        )
    assert "/usr/bin/chromium exited with code 1" in str(caught.value)
    assert "No usable sandbox" in str(caught.value)
    assert time.monotonic() - started < 2.5
    assert processes[0].killed


async def test_includes_stderr_when_the_report_times_out() -> None:
    with pytest.raises(TimeoutError) as caught:
        await capture_reference_report(
            server=FakeServer(),
            token="t2",
            timeout_ms=50,
            start=lambda *_args, **_options: FakeProcess(None, "GPU init failed"),
        )
    assert "timed out waiting for report t2\nbrowser stderr:\nGPU init failed" in str(
        caught.value
    )


async def test_keeps_waiting_when_a_launcher_script_exits_cleanly() -> None:
    calls: list[Any] = []

    def start(file: str, args: list[str], **options: Any) -> FakeProcess:
        calls.append((file, args, options))
        return FakeProcess(0)

    report = await capture_reference_report(
        executable_path="/usr/bin/chromium",
        server=FakeServer({"navigator": {"webdriver": False}}),
        token="t3",
        start=start,
    )
    assert report == {"navigator": {"webdriver": False}}
    assert isinstance(report, ProbeReport)
    assert isinstance(report.command_line, list)
    assert report.command_line == calls[0][1]
    assert report.command_line[-1] == "http://127.0.0.1:1/probe/t3"
    assert report.command_line[0].startswith("--user-data-dir=")
    assert calls[0][2] == {"kill_grace": 3.0}


async def test_probe_source_is_the_shared_javascript_probe() -> None:
    source = await read_probe_source()
    assert PROBE_SOURCE_PATH.name == "probe.js"
    assert source.strip()
    assert probe_expression("async () => 1") == "(async () => 1)()"


async def _request(port: int, request: bytes) -> tuple[str, bytes]:
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(request)
    await writer.drain()
    response = await reader.read()
    writer.close()
    head, _, body = response.partition(b"\r\n\r\n")
    return head.split(b"\r\n", 1)[0].decode("latin-1"), body


async def test_probe_server_serves_the_page_and_collects_the_report() -> None:
    server = await start_probe_server("async () => ({ ok: true })")
    try:
        url = server.url("tok")
        port = int(url.split(":")[2].split("/")[0])
        status, body = await _request(
            port,
            b"GET /probe/tok HTTP/1.1\r\nHost: 127.0.0.1\r\n"
            b"X-Probe: yes\r\nConnection: close\r\n\r\n",
        )
        assert status.split(" ")[1] == "200"
        assert b"async () => ({ ok: true })" in body
        assert server.headers_for("tok")["x-probe"] == "yes"

        payload = json.dumps({"navigator": {"webdriver": False}}).encode()
        status, _ = await _request(
            port,
            b"POST /report/tok HTTP/1.1\r\nHost: 127.0.0.1\r\n"
            b"Content-Type: application/json\r\n"
            + f"Content-Length: {len(payload)}\r\n".encode()
            + b"Connection: close\r\n\r\n"
            + payload,
        )
        assert status.split(" ")[1] == "204"
        report = await server.wait_for_report("tok", 1000)
        assert report == {"navigator": {"webdriver": False}}

        status, _ = await _request(
            port, b"GET /elsewhere HTTP/1.1\r\nConnection: close\r\n\r\n"
        )
        assert status.split(" ")[1] == "404"

        with pytest.raises(TimeoutError, match="timed out waiting for report none"):
            await server.wait_for_report("none", 20)
    finally:
        await server.close()
