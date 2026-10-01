"""Exercise the native relay over real WebSocket connections."""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager

import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus

from browser_commander.browser.extension_relay import (
    ExtensionRelay,
    RelayOptions,
    attach_via_extension,
    extension_directory,
)

EXTENSION_ID = "a" * 32
ORIGIN = f"chrome-extension://{EXTENSION_ID}"


@asynccontextmanager
async def connected_relay(**options):
    relay = await ExtensionRelay.listen(RelayOptions(port=0, **options))
    try:
        async with connect(relay.url, origin=ORIGIN) as extension:
            await extension.send(
                json.dumps(
                    {"type": "hello", "extensionVersion": "1.0", "userAgent": "Chrome"}
                )
            )
            await relay.wait_for_extension()
            yield relay, extension
    finally:
        await relay.close()


async def answer(extension, result=None, error=None):
    request = json.loads(await asyncio.wait_for(extension.recv(), 2))
    response = {"id": request["id"]}
    response["error" if error else "result"] = error or result
    await extension.send(json.dumps(response))
    return request


# feature-parity: attach.extension@native-typed
@pytest.mark.asyncio
async def test_native_relay_tabs_cdp_events_and_detach():
    async with connected_relay(allowed_extension_ids=[EXTENSION_ID]) as (
        relay,
        extension,
    ):
        assert relay.extension.id == EXTENSION_ID
        assert relay.extension.version == "1.0"
        assert relay.connected()
        tabs = asyncio.create_task(relay.tabs())
        request = await answer(
            extension,
            [
                {
                    "tabId": 7,
                    "url": "https://example.test",
                    "title": "Tab",
                    "active": True,
                }
            ],
        )
        assert request["method"] == "tabs.list"
        assert (await tabs)[0].tab_id == 7
        created = asyncio.create_task(relay.new_tab("https://example.test/new"))
        request = await answer(extension, {"tabId": 8})
        assert request["params"] == {"url": "https://example.test/new"}
        assert await created == 8
        attached = asyncio.create_task(relay.session(7))
        assert (await answer(extension, {"attached": True}))[
            "method"
        ] == "debugger.attach"
        session = await attached
        sent = asyncio.create_task(
            session.send("Runtime.evaluate", {"expression": "1"})
        )
        request = await answer(extension, {"result": {"value": 1}})
        assert request["params"] == {
            "tabId": 7,
            "method": "Runtime.evaluate",
            "params": {"expression": "1"},
        }
        assert (await sent)["result"]["value"] == 1
        await extension.send(
            json.dumps(
                {
                    "type": "event",
                    "tabId": 7,
                    "method": "Page.loadEventFired",
                    "params": {"timestamp": 2},
                }
            )
        )
        event = await asyncio.wait_for(session.next_event(), 2)
        assert event.method == "Page.loadEventFired"
        assert event.params == {"timestamp": 2}
        detach = asyncio.create_task(session.detach())
        assert (await answer(extension, {"detached": True}))[
            "method"
        ] == "debugger.detach"
        await detach
        assert session.detached
        with pytest.raises(ConnectionError, match="detached"):
            await session.send("Runtime.enable")


@pytest.mark.asyncio
async def test_native_relay_rejects_web_origins_wrong_paths_ids_and_duplicates():
    relay = await ExtensionRelay.listen(
        RelayOptions(port=0, allowed_extension_ids=[EXTENSION_ID])
    )
    try:
        for url, origin, status in (
            (relay.url, "https://example.test", 403),
            (relay.url, None, 403),
            (relay.url, "chrome-extension://" + "b" * 32, 403),
            (relay.url.replace("/browser-commander", "/wrong"), ORIGIN, 404),
        ):
            with pytest.raises(InvalidStatus) as error:
                async with connect(url, origin=origin):
                    pytest.fail("unauthorized connection accepted")
            assert error.value.response.status_code == status
        async with connect(relay.url, origin=ORIGIN):
            with pytest.raises(InvalidStatus) as error:
                async with connect(relay.url, origin=ORIGIN):
                    pytest.fail("second extension accepted")
            assert error.value.response.status_code == 409
    finally:
        await relay.close()


@pytest.mark.asyncio
async def test_native_relay_errors_timeouts_cancellation_and_disconnect():
    async with connected_relay(request_timeout=0.05) as (relay, extension):
        failure = asyncio.create_task(relay.tabs())
        await answer(extension, error={"message": "permission denied"})
        with pytest.raises(RuntimeError, match="permission denied"):
            await failure
        timed_out = asyncio.create_task(relay.tabs())
        await extension.recv()
        with pytest.raises(asyncio.TimeoutError):
            await timed_out
        assert not relay._pending
        cancelled = asyncio.create_task(relay.tabs())
        await extension.recv()
        cancelled.cancel()
        with pytest.raises(asyncio.CancelledError):
            await cancelled
        assert not relay._pending
        disconnected = asyncio.create_task(relay.tabs())
        await extension.recv()
        await extension.close()
        with pytest.raises(ConnectionError, match="disconnected"):
            await disconnected
        assert not relay.connected()


@pytest.mark.asyncio
async def test_native_relay_timeout_and_attach_cancellation_close_listener():
    with pytest.raises(ValueError, match="loopback"):
        await ExtensionRelay.listen(RelayOptions(host="0.0.0.0"))
    with pytest.raises(ValueError, match="positive"):
        await ExtensionRelay.listen(RelayOptions(timeout=0))
    relay = await ExtensionRelay.listen(RelayOptions(port=0, timeout=0.01))
    try:
        with pytest.raises(asyncio.TimeoutError):
            await relay.wait_for_extension()
    finally:
        await relay.close()
    listening = asyncio.get_running_loop().create_future()
    task = asyncio.create_task(
        attach_via_extension(RelayOptions(port=0), on_listening=listening.set_result)
    )
    info = await asyncio.wait_for(listening, 2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    with pytest.raises(OSError):
        await asyncio.open_connection("127.0.0.1", info.port)


@pytest.mark.asyncio
async def test_native_relay_reconnect_malformed_messages_and_remote_detach():
    relay = await ExtensionRelay.listen(RelayOptions(port=0))
    try:
        for _ in range(2):
            async with connect(relay.url, origin=ORIGIN) as extension:
                await extension.send('{"type":"hello"}')
                await relay.wait_for_extension()
                attached = asyncio.create_task(relay.session(7))
                await answer(extension, {"attached": True})
                session = await attached
                await extension.send("broken JSON")
                await extension.send("null")
                await extension.send('{"id":[],"result":null}')
                await extension.send('{"id":900,"result":null}')
                await extension.send('{"type":"keepalive"}')
                await extension.send(
                    '{"type":"detached","tabId":7,"reason":"user_cancelled"}'
                )
                event = await asyncio.wait_for(session.next_event(), 2)
                assert event.params == {"reason": "user_cancelled"}
                assert session.detached
            for _ in range(100):
                if not relay.connected():
                    break
                await asyncio.sleep(0.005)
            assert not relay.connected()
    finally:
        await relay.close()


@pytest.mark.asyncio
async def test_native_relay_concurrent_session_calls_await_the_same_attach():
    async with connected_relay() as (relay, extension):
        first = asyncio.create_task(relay.session(7))
        second = asyncio.create_task(relay.session(7))
        request = json.loads(await asyncio.wait_for(extension.recv(), 2))
        assert not first.done() and not second.done()
        await extension.send(
            json.dumps({"id": request["id"], "result": {"attached": True}})
        )
        assert await first is await second


def test_bundled_extension_is_identical_to_shared_protocol():
    from pathlib import Path

    canonical = Path(__file__).resolve().parents[4] / "js" / "extension"
    for name in ("manifest.json", "background.js", "relay-handler.js"):
        assert (extension_directory() / name).read_bytes() == (
            canonical / name
        ).read_bytes()
