"""The client side of ``browser-commander serve --stdio`` (issue #108).

The JavaScript CLI serves Puppeteer's live objects as remote handles over
JSON-RPC 2.0, one message per line (docs/cli-and-bridge.md). This module starts
that server through :func:`~browser_commander.utilities.subprocess.start_process`,
matches responses to requests, routes ``events.emit`` notifications to
subscriptions and converts values between Python and the bridge's tagged value
encoding. The generated wrappers in :mod:`browser_commander.puppeteer.api` are
thin typed calls on top of :class:`RemoteObject`.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import math
import os
import sys
from collections import deque
from collections.abc import Awaitable, Callable
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, ClassVar, TypeVar

from browser_commander.cli import js_cli_path
from browser_commander.utilities.subprocess import ManagedProcess, start_process

if TYPE_CHECKING:
    from browser_commander.puppeteer.api import PuppeteerNode

_STDERR_LINES = 50
_RUNTIME_PREFIXES = ("Cdp", "Bidi")
_PRIMITIVES: dict[str, type | tuple[type, ...]] = {
    "string": str,
    "boolean": bool,
    "number": (int, float),
}

T = TypeVar("T", bound="RemoteObject")


class BridgeError(Exception):
    """A call failed in the server or in Puppeteer behind it.

    ``name`` is the JavaScript error class (``TimeoutError``, ``TypeError``)
    or ``RpcError`` for protocol errors; ``code`` is the JSON-RPC error code.
    """

    def __init__(
        self,
        message: str,
        *,
        code: int = -32000,
        name: str = "RpcError",
        stack: str | None = None,
    ) -> None:
        super().__init__(f"{name}: {message}")
        self.message = message
        self.code = code
        self.name = name
        self.stack = stack

    @property
    def is_timeout(self) -> bool:
        """Whether Puppeteer reported a timeout."""
        return self.name == "TimeoutError"


class BridgeClosedError(BridgeError):
    """The server went away, or the bridge was closed."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason, code=-32000, name="BridgeClosed")


class _Undefined:
    """JavaScript's ``undefined``: a left-out optional argument."""

    _instance: ClassVar[_Undefined | None] = None

    def __new__(cls) -> _Undefined:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        return "UNDEFINED"


UNDEFINED = _Undefined()


def _opt(value: Any) -> Any:
    """An optional argument: ``None`` means "not given" (``undefined``)."""
    return UNDEFINED if value is None else value


class JsFunction:
    """A function argument compiled from source on the server.

    Puppeteer also takes a string where it takes a function: an expression for
    ``evaluate``, a selector for ``locator``. Pass a plain ``str`` for that.
    """

    __slots__ = ("source",)

    def __init__(self, source: str) -> None:
        self.source = source

    def to_wire(self) -> dict[str, str]:
        """The encoded argument."""
        return {"$function": self.source}

    def __repr__(self) -> str:
        return f"JsFunction({self.source!r})"

    def __eq__(self, other: object) -> bool:
        return isinstance(other, JsFunction) and other.source == self.source

    def __hash__(self) -> int:
        return hash(self.source)


def encode(value: Any) -> Any:
    """A Python value in the bridge's encoding.

    Remote objects become ``{"$handle": id}``, bytes ``$binary``,
    :class:`JsFunction` ``$function``, :data:`UNDEFINED` ``$undefined`` and
    datetimes ``$date``; NaN and the infinities become ``null`` as in JSON.
    """
    if value is UNDEFINED:
        return {"$undefined": True}
    if isinstance(value, RemoteObject):
        return value.remote.to_wire()
    if isinstance(value, RemoteHandle):
        return value.to_wire()
    if isinstance(value, JsFunction):
        return value.to_wire()
    if value is None or isinstance(value, (bool, str, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"$binary": base64.b64encode(bytes(value)).decode("ascii")}
    if isinstance(value, datetime):
        return {"$date": value.isoformat()}
    if isinstance(value, dict):
        return {str(key): encode(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [encode(item) for item in value]
    raise TypeError(f"cannot send {type(value).__name__} over the bridge")


def _encode_args(args: list[Any]) -> list[Any]:
    """Arguments for ``handle.call``, without trailing ``undefined`` ones."""
    trimmed = list(args)
    while trimmed and trimmed[-1] is UNDEFINED:
        trimmed.pop()
    return [encode(arg) for arg in trimmed]


def _parse_date(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


class RemoteHandle:
    """A Puppeteer object that lives in the server, such as a ``Page``."""

    __slots__ = ("client", "id", "type_name")

    def __init__(self, client: BridgeClient, handle_id: str, type_name: str) -> None:
        self.client = client
        self.id = handle_id
        self.type_name = type_name

    def __repr__(self) -> str:
        return f"RemoteHandle({self.id!r}, {self.type_name!r})"

    def __eq__(self, other: object) -> bool:
        return (
            isinstance(other, RemoteHandle)
            and other.client is self.client
            and other.id == self.id
        )

    def __hash__(self) -> int:
        return hash((id(self.client), self.id))

    def to_wire(self) -> dict[str, str]:
        """The handle as an argument: ``{"$handle": "h1"}``."""
        return {"$handle": self.id}

    async def call(self, method: str, args: list[Any] | None = None) -> Any:
        """``handle.call``; the raw, still-encoded result."""
        return await self.client.request(
            "handle.call",
            {"handle": self.id, "method": method, "args": _encode_args(args or [])},
        )

    async def get(self, prop: str) -> Any:
        """``handle.get``: read a property (awaited when it is a promise)."""
        return await self.client.request(
            "handle.get", {"handle": self.id, "property": prop}
        )

    async def describe(self) -> dict[str, Any]:
        """``handle.describe``: the object's type and member names."""
        return await self.client.request("handle.describe", {"handle": self.id})

    async def release(self) -> None:
        """``handle.dispose``: forget the handle on the server.

        The object itself stays alive; a ``JSHandle`` is disposed with its
        own ``dispose()`` method.
        """
        await self.client.request("handle.dispose", {"handle": self.id})

    async def subscribe(self, event: str) -> Subscription:
        """``events.subscribe``: receive every ``event`` the object emits."""
        result = await self.client.request(
            "events.subscribe", {"handle": self.id, "event": event}, subscribe=True
        )
        subscription_id = str(result["subscription"])
        subscription = self.client._subscriptions.get(subscription_id)
        if subscription is None:
            raise BridgeClosedError(self.client.closed or "the subscription was closed")
        return subscription


class Subscription:
    """Events from one ``events.subscribe``, as an async iterator.

    Each item is the list of the event's arguments, decoded (remote objects
    arrive as typed wrappers). Iteration ends when the bridge closes.
    """

    def __init__(self, client: BridgeClient, subscription_id: str) -> None:
        self.client = client
        self.id = subscription_id
        self._queue: asyncio.Queue[list[Any] | None] = asyncio.Queue()

    def _deliver(self, args: list[Any] | None) -> None:
        self._queue.put_nowait(args)

    async def next(self) -> list[Any] | None:
        """The next event's arguments, or ``None`` once closed."""
        return await self._queue.get()

    def __aiter__(self) -> Subscription:
        return self

    async def __anext__(self) -> list[Any]:
        args = await self.next()
        if args is None:
            raise StopAsyncIteration
        return args

    async def close(self) -> None:
        """``events.unsubscribe``."""
        if self.client._subscriptions.pop(self.id, None) is not None:
            self._deliver(None)
        await self.client.request("events.unsubscribe", {"subscription": self.id})


class BridgeClient:
    """A JSON-RPC conversation with one ``serve --stdio`` server.

    ``send`` writes one line to the server; output from the server is passed
    to :meth:`feed`. Requests are pipelined.
    """

    def __init__(
        self,
        send: Callable[[str], Awaitable[None]],
        close_input: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self._send = send
        self._close_input = close_input
        self._next_id = 1
        self._pending: dict[int, asyncio.Future[Any]] = {}
        self._subscribe_requests: set[int] = set()
        self._subscriptions: dict[str, Subscription] = {}
        self._buffer = ""
        self.closed: str | None = None

    def feed(self, chunk: str) -> None:
        """Take output from the server; complete lines are dispatched."""
        self._buffer += chunk
        *lines, self._buffer = self._buffer.split("\n")
        for line in lines:
            if not line.strip():
                continue
            try:
                message = json.loads(line)
            except ValueError:
                continue
            if isinstance(message, dict):
                self._dispatch(message)

    def _dispatch(self, message: dict[str, Any]) -> None:
        message_id = message.get("id")
        if isinstance(message_id, int):
            future = self._pending.pop(message_id, None)
            subscribe = message_id in self._subscribe_requests
            self._subscribe_requests.discard(message_id)
            if future is None or future.done():
                return
            error = message.get("error")
            if isinstance(error, dict):
                data = error.get("data") if isinstance(error.get("data"), dict) else {}
                future.set_exception(
                    BridgeError(
                        str(error.get("message", "")),
                        code=int(error.get("code", -32000)),
                        name=str(data.get("name") or "RpcError"),
                        stack=data.get("stack"),
                    )
                )
            else:
                result = message.get("result")
                if subscribe and isinstance(result, dict) and "subscription" in result:
                    # The server may emit right after answering, before the
                    # caller resumes: register the subscription now.
                    subscription_id = str(result["subscription"])
                    self._subscriptions[subscription_id] = Subscription(
                        self, subscription_id
                    )
                future.set_result(result)
            return
        if message.get("method") != "events.emit":
            return
        params = message.get("params") or {}
        subscription = self._subscriptions.get(str(params.get("subscription")))
        if subscription is not None:
            args = params.get("args")
            subscription._deliver(
                [self.decode(arg) for arg in args] if isinstance(args, list) else []
            )

    def close(self, reason: str = "the bridge was closed") -> None:
        """Fail pending and later requests with :class:`BridgeClosedError`."""
        if self.closed is None:
            self.closed = reason
        pending, self._pending = self._pending, {}
        self._subscribe_requests.clear()
        for future in pending.values():
            if not future.done():
                future.set_exception(BridgeClosedError(self.closed))
        subscriptions, self._subscriptions = self._subscriptions, {}
        for subscription in subscriptions.values():
            subscription._deliver(None)

    async def close_input(self) -> None:
        """End the server's input: it finishes in-flight work and exits."""
        self.close()
        if self._close_input is not None:
            with contextlib.suppress(OSError, ValueError, RuntimeError):
                await self._close_input()

    async def request(
        self, method: str, params: dict[str, Any], *, subscribe: bool = False
    ) -> Any:
        """Send a request and wait for its result.

        ``subscribe`` marks ``events.subscribe``, whose subscription must
        exist before the next message from the server is handled.
        """
        if self.closed is not None:
            raise BridgeClosedError(self.closed)
        message_id = self._next_id
        self._next_id += 1
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self._pending[message_id] = future
        if subscribe:
            self._subscribe_requests.add(message_id)
        line = json.dumps(
            {"jsonrpc": "2.0", "id": message_id, "method": method, "params": params},
            separators=(",", ":"),
            ensure_ascii=False,
        )
        try:
            await self._send(line + "\n")
        except (OSError, ValueError, RuntimeError) as error:
            self._pending.pop(message_id, None)
            self._subscribe_requests.discard(message_id)
            self.close(f"writing to the server failed: {error}")
            raise BridgeClosedError(self.closed or str(error)) from error
        return await future

    async def root(self, name: str) -> RemoteHandle:
        """``handle.root``: the engine's entry object (``puppeteer``)."""
        result = await self.request("handle.root", {"name": name})
        return RemoteHandle(self, result["$handle"], str(result.get("type", "")))

    def wrap(self, value: dict[str, Any], expected: str | None = None) -> RemoteObject:
        """A ``{"$handle": …}`` value as the most specific registered wrapper."""
        handle = RemoteHandle(self, str(value["$handle"]), str(value.get("type", "")))
        return RemoteObject._class_for(handle.type_name, expected)(handle)

    def decode(self, value: Any, kind: str = "json") -> Any:
        """A value from the server as the declared ``kind`` (see the manifest)."""
        nullable = kind.endswith("?")
        bare = kind[:-1] if nullable else kind
        if isinstance(value, dict) and "$undefined" in value:
            value = None
        if bare == "void":
            return None
        if value is None:
            return math.nan if bare == "number" and not nullable else None
        if bare.startswith("list:"):
            if not isinstance(value, list):
                raise BridgeError(f"expected a list, got {value!r}", name="DecodeError")
            return [self.decode(item, bare[5:]) for item in value]
        if bare.startswith("handle:"):
            if not (isinstance(value, dict) and "$handle" in value):
                raise BridgeError(
                    f"expected a remote object, got {value!r}", name="DecodeError"
                )
            return self.wrap(value, bare[7:])
        expected = _PRIMITIVES.get(bare)
        if expected is not None:
            if not isinstance(value, expected) or (
                bare == "number" and isinstance(value, bool)
            ):
                raise BridgeError(
                    f"expected a {bare}, got {value!r}", name="DecodeError"
                )
            if bare == "number" and isinstance(value, int):
                return float(value)
            return value
        return self._decode_json(value)

    def _decode_json(self, value: Any) -> Any:
        if isinstance(value, list):
            return [self._decode_json(item) for item in value]
        if not isinstance(value, dict):
            return value
        if "$handle" in value:
            return self.wrap(value)
        if "$binary" in value:
            return base64.b64decode(value["$binary"])
        if "$undefined" in value:
            return None
        if "$date" in value:
            return _parse_date(str(value["$date"]))
        if "$bigint" in value:
            return int(value["$bigint"])
        return {key: self._decode_json(item) for key, item in value.items()}


class RemoteObject:
    """Base of the generated Puppeteer wrappers: a typed remote object."""

    TYPE: ClassVar[str] = "RemoteObject"
    _registry: ClassVar[dict[str, type[RemoteObject]]] = {}

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        if "TYPE" in cls.__dict__:
            RemoteObject._registry[cls.TYPE] = cls

    def __init__(self, remote: RemoteHandle) -> None:
        self._remote = remote

    @classmethod
    def _class_for(cls, runtime: str, expected: str | None) -> type[RemoteObject]:
        """The wrapper for runtime class ``runtime`` (``CdpPage`` is a ``Page``)."""
        base = cls._registry.get(expected or "", RemoteObject)
        names = [runtime] + [
            runtime[len(prefix) :]
            for prefix in _RUNTIME_PREFIXES
            if runtime.startswith(prefix)
        ]
        for name in names:
            found = cls._registry.get(name)
            if found is not None and issubclass(found, base):
                return found
        return base

    @property
    def remote(self) -> RemoteHandle:
        """The handle behind the wrapper, for untyped calls."""
        return self._remote

    def cast(self, cls: type[T]) -> T:
        """View the same object as another wrapper type."""
        return cls(self._remote)

    async def _call(self, method: str, args: list[Any], kind: str) -> Any:
        value = await self._remote.call(method, args)
        return self._remote.client.decode(value, kind)

    async def _get(self, prop: str, kind: str) -> Any:
        value = await self._remote.get(prop)
        return self._remote.client.decode(value, kind)

    async def subscribe(self, event: str) -> Subscription:
        """Receive the arguments of every ``event`` the object emits."""
        return await self._remote.subscribe(event)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, RemoteObject) and other._remote == self._remote

    def __hash__(self) -> int:
        return hash(self._remote)

    def __repr__(self) -> str:
        return f"{type(self).__name__}({self._remote.id!r})"


class PuppeteerBridge:
    """A running ``browser-commander serve --stdio`` and its client.

    Use :meth:`launch`, preferably as ``async with``::

        async with await PuppeteerBridge.launch() as bridge:
            puppeteer = await bridge.puppeteer()
            browser = await puppeteer.launch({"headless": True})
            page = await browser.new_page()
            await page.goto("https://example.com")
            print(await page.title())
            await browser.close()
    """

    def __init__(self, process: ManagedProcess, client: BridgeClient) -> None:
        self.process = process
        self.client = client
        self._stderr: deque[str] = deque(maxlen=_STDERR_LINES)
        self._stderr_buffer = ""

    @classmethod
    async def launch(
        cls,
        *,
        node: str | os.PathLike[str] | None = None,
        cli: str | os.PathLike[str] | None = None,
        cwd: str | os.PathLike[str] | None = None,
        verbose: bool = False,
    ) -> PuppeteerBridge:
        """Start ``node <cli> serve --stdio``.

        Args:
            node: Node.js executable; ``BROWSER_COMMANDER_NODE``, then ``node``.
            cli: The JavaScript CLI; see :func:`browser_commander.cli.js_cli_path`.
            cwd: Working directory of the server.
            verbose: Echo the server's stderr.
        """
        executable = os.fspath(node or os.environ.get("BROWSER_COMMANDER_NODE", "node"))
        script = Path(cli) if cli is not None else js_cli_path()
        process = await start_process(
            executable,
            [str(script), "serve", "--stdio"],
            cwd=cwd,
            stdin_mode="pipe",
        )
        client = BridgeClient(process.write_stdin, process.close_stdin)
        bridge = cls(process, client)
        process.stdout.on("data", client.feed)

        def on_stderr(chunk: str) -> None:
            bridge._stderr_buffer += chunk
            *lines, bridge._stderr_buffer = bridge._stderr_buffer.split("\n")
            for line in lines:
                bridge._stderr.append(line)
                if verbose:
                    print(f"[serve --stdio] {line}", file=sys.stderr)

        process.stderr.on("data", on_stderr)
        process.on(
            "exit", lambda code: client.close(f"the server exited with code {code}")
        )
        return bridge

    async def puppeteer(self) -> PuppeteerNode:
        """The ``puppeteer`` module's default export, a ``PuppeteerNode``."""
        from browser_commander.puppeteer.api import PuppeteerNode

        return PuppeteerNode(await self.client.root("puppeteer"))

    def stderr_tail(self) -> list[str]:
        """The server's most recent stderr lines."""
        return list(self._stderr)

    async def close(self, timeout: float = 5.0) -> None:
        """End the server's input, wait for it to exit, then kill what is left.

        Close browsers started with ``PuppeteerNode.launch`` first.
        """
        await self.client.close_input()
        try:
            await asyncio.wait_for(self.process.wait(), timeout)
        except asyncio.TimeoutError:
            self.process.kill()
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self.process.wait(), timeout)

    async def __aenter__(self) -> PuppeteerBridge:
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        await self.close()
