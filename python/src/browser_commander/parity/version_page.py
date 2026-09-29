"""Read chrome://version of a browser started with the reference command line.

The browser rewrites its own command line: headless mode appends
``--ozone-platform=headless``, ``--use-angle=swiftshader-webgl``,
``--no-first-run`` and more, and a Linux build may append
``--ozone-platform=x11``. chrome://version shows the rewritten line, so the
automated browser's line cannot be compared with the argv a person typed. It is
compared with what the same binary shows for that argv instead.

A page cannot read chrome://version, so this capture needs a debugger. It uses
a fixed ``--remote-debugging-port`` - which issue #101 measured to change
nothing a page observes - and speaks raw CDP over a minimal standard-library
WebSocket client, so no automation engine (and no extra dependency) is
involved.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import inspect
import json
import os
import struct
import urllib.request
from typing import Any, Callable
from urllib.parse import urlsplit

from browser_commander.browser.debugging_port import reserve_loopback_port
from browser_commander.browser.profile_directory import (
    create_temporary_user_data_dir,
    remove_user_data_dir,
)
from browser_commander.utilities.subprocess import start_process

__all__ = ["READ_VERSION_PAGE", "CdpSocket", "read_reference_version_page"]

#: Evaluated in chrome://version; returns null until the page has rendered.
READ_VERSION_PAGE = """(() => {
  const text = (id) => (document.getElementById(id)?.textContent ?? '').trim();
  if (!text('command_line')) return null;
  return {
    commandLine: text('command_line'),
    version: text('version'),
    executablePath: text('executable_path'),
  };
})()"""

_POLL_INTERVAL = 0.1


class CdpSocket:
    """Send CDP commands over one page WebSocket (RFC 6455 text frames)."""

    def __init__(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        self._reader = reader
        self._writer = writer
        self._next_id = 1

    @classmethod
    async def connect(cls, url: str) -> CdpSocket:
        """Open ``ws://host:port/path`` and complete the upgrade handshake."""

        parts = urlsplit(url)
        if parts.scheme != "ws" or not parts.hostname:
            msg = f"unsupported DevTools WebSocket URL {url}"
            raise ValueError(msg)
        port = parts.port or 80
        reader, writer = await asyncio.open_connection(parts.hostname, port)
        path = parts.path or "/"
        if parts.query:
            path = f"{path}?{parts.query}"
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {parts.hostname}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        writer.write(request.encode("latin-1"))
        await writer.drain()
        head = await reader.readuntil(b"\r\n\r\n")
        status = head.split(b"\r\n", 1)[0].split(b" ")
        if len(status) < 2 or status[1] != b"101":
            writer.close()
            msg = f"WebSocket upgrade to {url} failed: {head[:200]!r}"
            raise ConnectionError(msg)
        return cls(reader, writer)

    async def _write_frame(self, opcode: int, payload: bytes) -> None:
        header = bytearray([0x80 | opcode])
        length = len(payload)
        if length < 126:
            header.append(0x80 | length)
        elif length < 1 << 16:
            header.append(0x80 | 126)
            header += struct.pack("!H", length)
        else:
            header.append(0x80 | 127)
            header += struct.pack("!Q", length)
        mask = os.urandom(4)
        masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        self._writer.write(bytes(header) + mask + masked)
        await self._writer.drain()

    async def _read_frame(self) -> tuple[int, bool, bytes]:
        first, second = await self._reader.readexactly(2)
        length = second & 0x7F
        if length == 126:
            (length,) = struct.unpack("!H", await self._reader.readexactly(2))
        elif length == 127:
            (length,) = struct.unpack("!Q", await self._reader.readexactly(8))
        mask = await self._reader.readexactly(4) if second & 0x80 else b""
        payload = await self._reader.readexactly(length)
        if mask:
            payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
        return first & 0x0F, bool(first & 0x80), payload

    async def _read_message(self) -> str:
        buffer = b""
        while True:
            opcode, final, payload = await self._read_frame()
            if opcode == 0x8:
                msg = "DevTools WebSocket closed"
                raise ConnectionError(msg)
            if opcode == 0x9:
                await self._write_frame(0xA, payload)
                continue
            if opcode == 0xA:
                continue
            buffer += payload
            if final:
                return buffer.decode("utf-8")

    async def send(self, method: str, params: dict[str, Any] | None = None) -> Any:
        """Send one command and wait for its reply.

        Raises:
            RuntimeError: ``<method>: <message>`` when CDP answers with an error.
        """

        message_id = self._next_id
        self._next_id += 1
        payload = {"id": message_id, "method": method, "params": params or {}}
        await self._write_frame(0x1, json.dumps(payload).encode("utf-8"))
        while True:
            message = json.loads(await self._read_message())
            if message.get("id") != message_id:
                continue
            if message.get("error"):
                msg = f"{method}: {message['error'].get('message')}"
                raise RuntimeError(msg)
            return message.get("result")

    async def close(self) -> None:
        """Close the socket without waiting for the peer."""

        with contextlib.suppress(Exception):
            await self._write_frame(0x8, b"")
        self._writer.close()
        with contextlib.suppress(Exception):
            await self._writer.wait_closed()


def _put_json(url: str) -> Any:
    request = urllib.request.Request(url, method="PUT")
    with urllib.request.urlopen(request, timeout=2) as response:
        if response.status != 200:
            msg = f"HTTP {response.status}"
            raise OSError(msg)
        return json.loads(response.read().decode("utf-8"))


async def _open_version_target(port: int, deadline: float) -> Any:
    loop = asyncio.get_running_loop()
    url = f"http://127.0.0.1:{port}/json/new?chrome://version"
    while loop.time() < deadline:
        with contextlib.suppress(OSError, ValueError):
            # OSError: the DevTools HTTP server is not up yet.
            return await asyncio.to_thread(_put_json, url)
        await asyncio.sleep(_POLL_INTERVAL)
    msg = f"no DevTools endpoint on port {port}"
    raise TimeoutError(msg)


async def _evaluate_until_ready(cdp: CdpSocket, deadline: float) -> Any:
    loop = asyncio.get_running_loop()
    while loop.time() < deadline:
        reply = await cdp.send(
            "Runtime.evaluate",
            {"expression": READ_VERSION_PAGE, "returnByValue": True},
        )
        value = ((reply or {}).get("result") or {}).get("value")
        if value:
            return value
        await asyncio.sleep(_POLL_INTERVAL)
    msg = "chrome://version did not render"
    raise TimeoutError(msg)


async def read_reference_version_page(
    *,
    executable_path: str,
    headless: bool = False,
    timeout: float = 30000,
    start: Callable[..., Any] = start_process,
) -> dict[str, str]:
    """Start ``executable_path`` with the reference argv and read chrome://version.

    Args:
        executable_path: Browser binary.
        headless: Add ``--headless=new``.
        timeout: Milliseconds to wait for the DevTools endpoint and the page.
        start: ``start(file, args, kill_grace=...)`` returning a process with
            ``kill()`` and ``wait()``.

    Returns:
        ``{"commandLine", "version", "executablePath"}`` as the page shows them.
    """

    user_data_dir = await asyncio.to_thread(create_temporary_user_data_dir)
    port = reserve_loopback_port()
    args = [
        f"--user-data-dir={user_data_dir}",
        f"--remote-debugging-port={port}",
        *(["--headless=new"] if headless else []),
        "about:blank",
    ]
    try:
        child = start(executable_path, args, kill_grace=3.0)
        if inspect.isawaitable(child):
            child = await child
    except BaseException:
        await asyncio.to_thread(remove_user_data_dir, user_data_dir)
        raise
    cdp: CdpSocket | None = None
    try:
        deadline = asyncio.get_running_loop().time() + timeout / 1000
        target = await _open_version_target(port, deadline)
        cdp = await CdpSocket.connect(target["webSocketDebuggerUrl"])
        return await _evaluate_until_ready(cdp, deadline)
    finally:
        if cdp is not None:
            await cdp.close()
        child.kill()
        with contextlib.suppress(Exception):
            waited = child.wait()
            if inspect.isawaitable(waited):
                await waited
        await asyncio.to_thread(remove_user_data_dir, user_data_dir)
