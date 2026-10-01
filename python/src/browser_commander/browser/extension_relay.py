"""Native loopback relay for the shared Browser Commander companion extension.

Install ``browser-commander[extension]`` and load ``js/extension`` once in
Chrome. The browser supplies the extension Origin; an optional ID allowlist
restricts which installed extension may connect. This doesn't authenticate
other local programs, which can construct their own HTTP headers.
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
import re
from dataclasses import dataclass
from http import HTTPStatus
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable
from urllib.parse import urlsplit

if TYPE_CHECKING:
    from websockets.asyncio.server import Server, ServerConnection
    from websockets.http11 import Request, Response

LOGGER = logging.getLogger(__name__)
DEFAULT_RELAY_PORT = 9333
RELAY_PATH = "/browser-commander"
_ORIGIN = re.compile(r"chrome-extension://([a-z0-9]+)\Z")
_MAX_PENDING = 64
_MAX_EVENTS = 1024


@dataclass
class RelayOptions:
    """Native relay options; all durations are seconds."""

    host: str = "127.0.0.1"
    port: int = DEFAULT_RELAY_PORT
    timeout: float = 60
    request_timeout: float = 30
    allowed_extension_ids: list[str] | None = None

    def validate(self) -> None:
        if self.host not in ("127.0.0.1", "::1", "localhost"):
            raise ValueError("The extension relay must listen on loopback")
        if (
            isinstance(self.port, bool)
            or not isinstance(self.port, int)
            or not 0 <= self.port <= 65535
        ):
            raise ValueError("port must be an integer between 0 and 65535")
        for duration in (self.timeout, self.request_timeout):
            if not math.isfinite(duration) or duration <= 0:
                raise ValueError("Relay timeouts must be finite and positive")
        if self.allowed_extension_ids is not None and (
            not isinstance(self.allowed_extension_ids, list)
            or any(not isinstance(value, str) for value in self.allowed_extension_ids)
        ):
            raise ValueError("allowed_extension_ids must be a list of strings")


@dataclass(frozen=True)
class RelayExtension:
    id: str
    version: str
    user_agent: str


@dataclass(frozen=True)
class RelayAddress:
    port: int
    url: str


@dataclass(frozen=True)
class RelayTab:
    tab_id: int
    url: str
    title: str
    active: bool


@dataclass(frozen=True)
class RelayEvent:
    method: str
    params: dict[str, Any]


class RelaySession:
    """A tab's CDP session; disconnect/detach wakes waiting event consumers."""

    def __init__(self, relay: ExtensionRelay, tab_id: int):
        self.tab_id = tab_id
        self.detached = False
        self._relay = relay
        self._events: asyncio.Queue[RelayEvent] = asyncio.Queue(_MAX_EVENTS)

    async def send(
        self, method: str, params: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        if self.detached:
            raise ConnectionError(f"Debugger session of tab {self.tab_id} is detached")
        return await self._relay._request(
            "cdp.send", {"tabId": self.tab_id, "method": method, "params": params or {}}
        )

    async def next_event(self) -> RelayEvent:
        """Receive the next CDP event; a terminal event has method ``detached``."""
        if self.detached and self._events.empty():
            raise ConnectionError(f"Debugger session of tab {self.tab_id} is detached")
        return await self._events.get()

    async def detach(self) -> None:
        if not self.detached:
            await self._relay._request("debugger.detach", {"tabId": self.tab_id})
            self._mark_detached("detached_by_client")

    def _mark_detached(self, reason: str) -> None:
        if self.detached:
            return
        self.detached = True
        self._relay._sessions.pop(self.tab_id, None)
        if self._events.full():
            self._events.get_nowait()
        self._events.put_nowait(RelayEvent("detached", {"reason": reason}))

    def _event(self, method: str, params: dict[str, Any]) -> None:
        if self._events.full():
            self._mark_detached("event_buffer_overflow")
        else:
            self._events.put_nowait(RelayEvent(method, params))


class ExtensionRelay:
    """Native typed relay independent of Playwright, Selenium and Node.js.

    ``listen`` returns immediately; configure the extension with ``port``, then
    await ``wait_for_extension``. Always call ``close`` or use ``async with``.
    Message buffers are bounded; event overflow explicitly ends that session.
    """

    mode = "extension"

    def __init__(self, options: RelayOptions):
        self.options = options
        self.port = options.port
        self.url = ""
        self.extension: RelayExtension | None = None
        self._server: Server | None = None
        self._connection: ServerConnection | None = None
        self._reserved: ServerConnection | None = None
        self._hello = asyncio.Event()
        self._closed = False
        self._next_id = 1
        self._pending: dict[int, asyncio.Future[Any]] = {}
        self._sessions: dict[int, RelaySession] = {}
        self._session_lock = asyncio.Lock()

    @classmethod
    async def listen(cls, options: RelayOptions | None = None) -> ExtensionRelay:
        from websockets.asyncio.server import serve

        options = options or RelayOptions()
        options.validate()
        relay = cls(options)
        relay._server = await serve(
            relay._handle_connection,
            "127.0.0.1" if options.host == "localhost" else options.host,
            options.port,
            process_request=relay._authorize,
            process_response=relay._reserve,
            open_timeout=10,
            close_timeout=1,
            max_size=4 * 1024 * 1024,
            max_queue=16,
            compression=None,
        )
        relay.port = next(iter(relay._server.sockets)).getsockname()[1]
        host = f"[{options.host}]" if ":" in options.host else options.host
        relay.url = f"ws://{host}:{relay.port}{RELAY_PATH}"
        return relay

    def _authorize(
        self, connection: ServerConnection, request: Request
    ) -> Response | None:
        if urlsplit(request.path).path != RELAY_PATH:
            return connection.respond(HTTPStatus.NOT_FOUND, "Not found\n")
        origins = request.headers.get_all("Origin")
        match = _ORIGIN.fullmatch(origins[0]) if len(origins) == 1 else None
        allowed = self.options.allowed_extension_ids
        if not match or (allowed is not None and match[1] not in allowed):
            return connection.respond(
                HTTPStatus.FORBIDDEN, "Extension origin not allowed\n"
            )
        if self._connection is not None or self._reserved is not None:
            return connection.respond(
                HTTPStatus.CONFLICT, "An extension is already connected\n"
            )
        return None

    def _reserve(
        self, connection: ServerConnection, request: Request, response: Response
    ) -> Response:
        if response.status_code == 101:
            if self._connection is not None or self._reserved is not None:
                return connection.respond(
                    HTTPStatus.CONFLICT, "An extension is already connected\n"
                )
            self._reserved = connection
        return response

    async def _handle_connection(self, connection: ServerConnection) -> None:
        from websockets.exceptions import ConnectionClosed

        self._connection = connection
        self._reserved = None
        try:
            first = await asyncio.wait_for(connection.recv(), self.options.timeout)
            hello = json.loads(first)
            if not isinstance(hello, dict) or hello.get("type") != "hello":
                await connection.close(1008, "Expected extension hello")
                return
            assert connection.request is not None
            origin = connection.request.headers["Origin"]
            match = _ORIGIN.fullmatch(origin)
            assert match is not None
            self.extension = RelayExtension(
                match[1],
                str(hello.get("extensionVersion", "")),
                str(hello.get("userAgent", "")),
            )
            self._hello.set()
            async for frame in connection:
                try:
                    message = json.loads(frame)
                except (ValueError, UnicodeDecodeError):
                    LOGGER.debug("Ignoring malformed relay message")
                    continue
                if isinstance(message, dict):
                    self._handle_message(message)
        except (ConnectionClosed, asyncio.TimeoutError, ValueError):
            LOGGER.debug("Extension relay connection ended", exc_info=True)
        finally:
            self._disconnect("the extension disconnected")

    def _handle_message(self, message: dict[str, Any]) -> None:
        kind = message.get("type")
        tab_id = message.get("tabId")
        session = self._sessions.get(tab_id) if isinstance(tab_id, int) else None
        if kind == "event" and session is not None:
            method, params = message.get("method"), message.get("params", {})
            if isinstance(method, str) and isinstance(params, dict):
                session._event(method, params)
        elif kind == "detached" and session is not None:
            session._mark_detached(str(message.get("reason", "detached")))
        else:
            request_id = message.get("id")
            if not isinstance(request_id, int) or isinstance(request_id, bool):
                return
            future = self._pending.pop(request_id, None)
            if future is None or future.done():
                return
            if message.get("error"):
                error = message["error"]
                detail = (
                    error.get("message", "unknown error")
                    if isinstance(error, dict)
                    else str(error)
                )
                future.set_exception(RuntimeError(str(detail)))
            else:
                future.set_result(message.get("result"))

    def _disconnect(self, reason: str) -> None:
        self.extension = None
        self._connection = None
        self._hello.clear()
        for future in self._pending.values():
            if not future.done():
                future.set_exception(ConnectionError(reason))
        self._pending.clear()
        for session in list(self._sessions.values()):
            session._mark_detached(reason)

    def connected(self) -> bool:
        return self.extension is not None

    async def wait_for_extension(self) -> RelayExtension:
        if self._closed:
            raise ConnectionError("The relay was closed")
        await asyncio.wait_for(self._hello.wait(), self.options.timeout)
        if self._closed:
            raise ConnectionError("The relay was closed")
        if self.extension is None:
            raise ConnectionError("The extension disconnected")
        return self.extension

    async def _request(self, method: str, params: dict[str, Any] | None = None) -> Any:
        connection = self._connection
        if connection is None or self.extension is None:
            raise ConnectionError(
                "The Browser Commander Relay extension is not connected"
            )
        if len(self._pending) >= _MAX_PENDING:
            raise RuntimeError("Too many pending extension requests")
        request_id = self._next_id
        self._next_id += 1
        future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        try:
            await connection.send(
                json.dumps({"id": request_id, "method": method, "params": params or {}})
            )
            return await asyncio.wait_for(future, self.options.request_timeout)
        finally:
            self._pending.pop(request_id, None)
            if not future.done():
                future.cancel()
            elif not future.cancelled():
                future.exception()

    async def tabs(self) -> list[RelayTab]:
        values = await self._request("tabs.list")
        return [
            RelayTab(item["tabId"], item["url"], item["title"], item["active"])
            for item in values
        ]

    async def new_tab(self, url: str | None = None) -> int:
        result = await self._request("tabs.create", {} if url is None else {"url": url})
        return int(result["tabId"])

    async def session(self, tab_id: int) -> RelaySession:
        if isinstance(tab_id, bool) or not isinstance(tab_id, int):
            raise ValueError("tab_id must be an integer")
        async with self._session_lock:
            existing = self._sessions.get(tab_id)
            if existing is not None:
                return existing
            session = RelaySession(self, tab_id)
            self._sessions[tab_id] = session
            try:
                await self._request("debugger.attach", {"tabId": tab_id})
            except BaseException:
                session._mark_detached("attach_failed")
                raise
            return session

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._disconnect("the relay was closed")
        self._hello.set()
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    async def __aenter__(self) -> ExtensionRelay:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()


async def attach_via_extension(
    options: RelayOptions | None = None,
    *,
    on_listening: Callable[[RelayAddress], None] | None = None,
) -> ExtensionRelay:
    """Listen and await the extension hello, cleaning up failure/cancellation."""
    relay = await ExtensionRelay.listen(options)
    try:
        if on_listening is not None:
            on_listening(RelayAddress(relay.port, relay.url))
        await relay.wait_for_extension()
    except BaseException:
        await relay.close()
        raise
    return relay


def extension_directory() -> Path:
    """The bundled unpacked extension to select in Chrome's extension settings."""
    return Path(__file__).with_name("extension_assets")
