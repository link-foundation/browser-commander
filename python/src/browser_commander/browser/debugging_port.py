"""Reserve a fixed loopback DevTools port and prove the browser owns it.

A fixed, non-zero ``--remote-debugging-port`` is the only CDP transport that
leaves ``navigator.webdriver`` false without the unsupported
``--disable-blink-features=AutomationControlled`` switch: Chromium's
``content/child/runtime_features.cc`` treats ``--remote-debugging-pipe`` and
``--remote-debugging-port=0`` as automation, but a specific port as a human
attaching a debugger (issue #101).

The port is reserved by binding ``127.0.0.1:0``, reading the port the kernel
picked and closing the socket. Another process can take the port between that
close and Chrome's bind, so the launcher confirms ownership and retries.

Chrome only writes ``DevToolsActivePort`` into the profile for port 0 (see
``chrome/browser/devtools/remote_debugging_server.cc``), so for a fixed port
ownership is confirmed from the line Chromium prints to stderr when its
DevTools server starts::

    DevTools listening on ws://127.0.0.1:<port>/devtools/browser/<id>

When the loopback port is taken Chromium logs ``bind() failed: Address already
in use`` and falls back to ``[::1]:<port>``; when both fail it logs ``Cannot
start http server for devtools``. Either outcome is reported as a race.
"""

from __future__ import annotations

import re
import socket
import sys
from dataclasses import dataclass
from typing import Any, Literal

LOOPBACK_HOST = "127.0.0.1"

DevToolsOwnership = Literal["owned", "race", "pending"]


class PortRaceError(RuntimeError):
    """The reserved port was taken before the browser could bind it."""

    def __init__(self, port: int, detail: str | None = None) -> None:
        suffix = f" ({detail})" if detail else ""
        super().__init__(
            f"Remote debugging port {port} was taken by another process "
            f"before the browser bound it{suffix}"
        )
        self.port = port


def reserve_loopback_port(*, host: str = LOOPBACK_HOST) -> int:
    """Reserve a free loopback TCP port for ``--remote-debugging-port``.

    Returns:
        A port that was free a moment ago.
    """

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        if sys.platform == "win32" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            server.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        server.bind((host, 0))
        return int(server.getsockname()[1])


def assert_fixed_debugging_port(port: Any) -> int:
    """Validate a caller-supplied debugging port; zero is refused on purpose.

    Raises:
        ValueError: For 0 (it turns AutomationControlled on) and for anything
            that is not an integer from 1 to 65535.
    """

    if isinstance(port, int) and not isinstance(port, bool) and port == 0:
        msg = (
            "remote_debugging_port 0 makes Chrome enable AutomationControlled "
            "(navigator.webdriver is true); omit it so a free fixed port is "
            "reserved"
        )
        raise ValueError(msg)
    if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65_535:
        msg = "remote_debugging_port must be an integer from 1 to 65535"
        raise ValueError(msg)
    return port


_LISTENING_PATTERN = re.compile(
    r"DevTools listening on (ws://(\[[^\]]+\]|[^:/\s]+):(\d+)/devtools/browser/[^\s]+)"
)
# A bare `bind() failed` can come from unrelated sockets (media router, mDNS),
# so only DevTools' own give-up message counts as a failure on its own.
_BIND_FAILURE_PATTERN = re.compile(r"Cannot start http server for devtools", re.I)


@dataclass(frozen=True)
class DevToolsListening:
    """The endpoint a browser announced on stderr."""

    url: str
    host: str
    port: int


@dataclass(frozen=True)
class DevToolsOutput:
    """What the browser's stderr says about its DevTools server so far."""

    listening: DevToolsListening | None = None
    bind_failed: bool = False


def parse_dev_tools_output(text: str) -> DevToolsOutput:
    """Parse Chromium's DevTools startup output."""

    match = _LISTENING_PATTERN.search(text)
    listening = None
    if match:
        listening = DevToolsListening(
            url=match.group(1),
            host=match.group(2).strip("[]"),
            port=int(match.group(3)),
        )
    return DevToolsOutput(
        listening=listening,
        bind_failed=bool(_BIND_FAILURE_PATTERN.search(text)),
    )


class DevToolsOutputWatcher:
    """Collects a browser's stderr to find the DevTools listening line."""

    def __init__(self, stream: Any = None, *, forward: bool = False) -> None:
        self.available = stream is not None and callable(getattr(stream, "on", None))
        self._forward = forward
        self._text = ""
        self._settled: DevToolsOutput | None = None
        if self.available:
            stream.on("data", self._receive)

    def _receive(self, chunk: Any) -> None:
        text = chunk.decode("utf-8", "replace") if isinstance(chunk, bytes) else chunk
        if self._forward:
            sys.stderr.write(str(text))
        if self._settled is not None:
            return
        # Only the startup lines matter; cap the buffer so it cannot grow forever.
        self._text = f"{self._text}{text}"[-65_536:]
        parsed = parse_dev_tools_output(self._text)
        if parsed.listening is not None:
            self._settled = parsed

    def state(self) -> DevToolsOutput:
        """The parsed output so far (fixed once the listening line is seen)."""
        return self._settled or parse_dev_tools_output(self._text)


def watch_dev_tools_output(
    stream: Any = None, *, forward: bool = False
) -> DevToolsOutputWatcher:
    """Watch a browser's stderr channel (anything with ``on("data", fn)``)."""

    return DevToolsOutputWatcher(stream, forward=forward)


def classify_dev_tools_ownership(
    output: DevToolsOutput, port: int
) -> DevToolsOwnership:
    """Decide whether ``output`` proves ``port`` is ours, proves a race, or neither."""

    listening = output.listening
    if listening is not None:
        if listening.port == port and listening.host == LOOPBACK_HOST:
            return "owned"
        return "race"
    return "race" if output.bind_failed else "pending"
