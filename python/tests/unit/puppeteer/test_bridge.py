"""The Puppeteer bridge client and its generated wrappers against a fake server."""

from __future__ import annotations

import asyncio
import json
import math
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

import pytest

from browser_commander.puppeteer import (
    PUPPETEER_VERSION,
    UNDEFINED,
    BridgeClient,
    BridgeClosedError,
    BridgeError,
    Browser,
    ElementHandle,
    JsFunction,
    JSHandle,
    Page,
    PuppeteerNode,
    RemoteObject,
)
from browser_commander.puppeteer.bridge import encode

Responder = Callable[[dict[str, Any]], list[dict[str, Any]]]


class FakeServer:
    """Answers each request line with ``respond``'s messages, in one chunk."""

    def __init__(self, respond: Responder) -> None:
        self.respond = respond
        self.requests: list[dict[str, Any]] = []
        self.client = BridgeClient(self.send)

    async def send(self, line: str) -> None:
        request = json.loads(line)
        self.requests.append(request)
        replies = self.respond(request)
        if replies:
            chunk = "".join(json.dumps(reply) + "\n" for reply in replies)
            asyncio.get_running_loop().call_soon(self.client.feed, chunk)


async def discard(_line: str) -> None:
    """A server that never answers."""


def result(request: dict[str, Any], value: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request["id"], "result": value}


def handle(handle_id: str, type_name: str) -> dict[str, str]:
    return {"$handle": handle_id, "type": type_name}


def test_generated_api_matches_the_manifest_version() -> None:
    assert PUPPETEER_VERSION.split(".")[0].isdigit()
    assert issubclass(PuppeteerNode, RemoteObject)
    assert issubclass(ElementHandle, JSHandle)


def test_values_are_encoded_with_the_bridge_tags() -> None:
    assert encode(UNDEFINED) == {"$undefined": True}
    assert encode(b"hi") == {"$binary": "aGk="}
    assert encode(JsFunction("() => 1")) == {"$function": "() => 1"}
    assert encode(math.nan) is None
    assert encode((1, {"a": [True, None]})) == [1, {"a": [True, None]}]
    assert encode(datetime(2026, 1, 2, tzinfo=timezone.utc)) == {
        "$date": "2026-01-02T00:00:00+00:00"
    }
    with pytest.raises(TypeError):
        encode(object())


async def test_typed_calls_trim_undefined_and_wrap_runtime_classes() -> None:
    def respond(request: dict[str, Any]) -> list[dict[str, Any]]:
        method = request["method"]
        params = request["params"]
        if method == "handle.root":
            return [result(request, handle("h1", "PuppeteerNode"))]
        if params.get("method") == "launch":
            return [result(request, handle("h2", "CdpBrowser"))]
        if params.get("method") == "newPage":
            return [result(request, handle("h3", "CdpPage"))]
        if params.get("method") == "$":
            return [result(request, handle("h4", "CdpElementHandle"))]
        if params.get("method") == "evaluate":
            return [result(request, {"$bigint": "12345678901234567890"})]
        if params.get("method") == "screenshot":
            return [result(request, {"$binary": "iVBORw=="})]
        if method == "handle.get":
            return [result(request, None)]
        return [result(request, {"$undefined": True})]

    server = FakeServer(respond)
    puppeteer = PuppeteerNode(await server.client.root("puppeteer"))
    browser = await puppeteer.launch()
    assert type(browser) is Browser
    page = await browser.new_page()
    assert type(page) is Page
    element = await page.query_selector("#x")
    assert type(element) is ElementHandle
    assert await page.evaluate(JsFunction("(a) => a"), element) == 12345678901234567890
    assert await page.screenshot() == b"\x89PNG"
    assert await page.set_content("<p>", None) is None

    calls = [r["params"] for r in server.requests if r["method"] == "handle.call"]
    assert calls[0] == {"handle": "h1", "method": "launch", "args": []}
    assert calls[2] == {"handle": "h3", "method": "$", "args": ["#x"]}
    assert calls[3]["args"] == [{"$function": "(a) => a"}, {"$handle": "h4"}]
    assert calls[5] == {"handle": "h3", "method": "setContent", "args": ["<p>"]}


async def test_declared_kinds_are_enforced() -> None:
    client = BridgeClient(discard)
    assert math.isnan(client.decode(None, "number"))
    assert client.decode(None, "number?") is None
    assert client.decode(3, "number") == 3.0
    assert client.decode(True, "boolean") is True
    assert client.decode({"$undefined": True}, "string?") is None
    assert client.decode([handle("h1", "BidiPage")], "list:handle:Page")[0] == Page(
        client.wrap(handle("h1", "Page")).remote
    )
    with pytest.raises(BridgeError):
        client.decode("x", "number")
    with pytest.raises(BridgeError):
        client.decode(True, "number")
    with pytest.raises(BridgeError):
        client.decode(1, "handle:Page")


async def test_errors_carry_the_engine_error_name() -> None:
    def respond(request: dict[str, Any]) -> list[dict[str, Any]]:
        error = {
            "code": -32000,
            "message": "Waiting for selector `#x` failed",
            "data": {"name": "TimeoutError", "stack": "at x"},
        }
        return [{"jsonrpc": "2.0", "id": request["id"], "error": error}]

    server = FakeServer(respond)
    with pytest.raises(BridgeError) as caught:
        await server.client.request("handle.call", {})
    assert caught.value.is_timeout
    assert caught.value.stack == "at x"


async def test_events_emitted_with_the_subscribe_response_are_delivered() -> None:
    def respond(request: dict[str, Any]) -> list[dict[str, Any]]:
        if request["method"] == "events.subscribe":
            return [
                result(request, {"subscription": "e1"}),
                {
                    "jsonrpc": "2.0",
                    "method": "events.emit",
                    "params": {"subscription": "e1", "args": [handle("h3", "CdpPage")]},
                },
            ]
        if request["method"] == "handle.root":
            return [result(request, handle("h1", "CdpBrowser"))]
        return [result(request, None)]

    server = FakeServer(respond)
    browser = Browser(await server.client.root("puppeteer"))
    subscription = await browser.subscribe("targetcreated")
    (page,) = await asyncio.wait_for(subscription.next(), 1) or []
    assert isinstance(page, Page)
    await subscription.close()
    assert await subscription.next() is None


async def test_a_closed_bridge_fails_pending_and_later_calls() -> None:
    server = FakeServer(lambda _request: [])
    pending = asyncio.ensure_future(server.client.request("handle.root", {}))
    await asyncio.sleep(0)
    server.client.close("the server exited with code 1")
    with pytest.raises(BridgeClosedError, match="code 1"):
        await pending
    with pytest.raises(BridgeClosedError):
        await server.client.request("handle.root", {})


async def test_lines_split_across_chunks_are_reassembled() -> None:
    client = BridgeClient(discard)
    pending = asyncio.ensure_future(client.request("handle.root", {}))
    await asyncio.sleep(0)
    client.feed('{"jsonrpc":"2.0","id":1,"res')
    client.feed('ult":"é"}\n')
    assert await pending == "é"
