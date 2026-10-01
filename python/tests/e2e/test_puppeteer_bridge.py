"""Typed Puppeteer from Python over ``serve --stdio`` against a real Chrome."""

from __future__ import annotations

import asyncio
import os
import shutil

import pytest

from browser_commander.cli import js_cli_path
from browser_commander.puppeteer import (
    BridgeError,
    ConsoleMessage,
    ElementHandle,
    JsFunction,
    Page,
    PuppeteerBridge,
)

pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(
        os.environ.get("RUN_E2E", "").lower() not in {"1", "true", "yes"},
        reason="set RUN_E2E=true to drive a real Chrome through the bridge",
    ),
]


def launch_options() -> dict[str, object]:
    options: dict[str, object] = {"headless": True}
    if os.environ.get("CHROME_PATH"):
        options["executablePath"] = os.environ["CHROME_PATH"]
    else:
        options["channel"] = "chrome"
    if os.environ.get("CHROME_NO_SANDBOX") == "true":
        options["args"] = ["--no-sandbox"]
    return options


# feature-parity: engine.puppeteer@typed-via-bridge
async def test_typed_puppeteer_over_the_bridge() -> None:
    if shutil.which("node") is None or not js_cli_path().is_file():
        pytest.skip("Node.js or the JavaScript CLI is not available")

    async def exercise() -> None:
        async with await PuppeteerBridge.launch() as bridge:
            puppeteer = await bridge.puppeteer()
            browser = await puppeteer.launch(launch_options())
            try:
                page = await browser.new_page()
                assert isinstance(page, Page)
                await page.set_content(
                    "<title>bridge</title><p id='greeting'>héllo</p>"
                )
                assert await page.title() == "bridge"
                assert await page.evaluate(JsFunction("(a, b) => a + b"), 2, 3) == 5

                paragraph = await page.query_selector("#greeting")
                assert isinstance(paragraph, ElementHandle)
                text = await page.eval_on_selector(
                    "#greeting", JsFunction("(node) => node.textContent")
                )
                assert text == "héllo"
                assert await page.query_selector("#missing") is None

                png = await page.screenshot({"type": "png"})
                assert isinstance(png, bytes)
                assert png.startswith(b"\x89PNG")

                subscription = await page.subscribe("console")
                await page.evaluate(JsFunction("() => console.log('from the page')"))
                (message,) = await asyncio.wait_for(subscription.next(), 10) or []
                assert isinstance(message, ConsoleMessage)
                assert await message.text() == "from the page"
                await subscription.close()

                with pytest.raises(BridgeError) as caught:
                    await page.wait_for_selector("#never", {"timeout": 50})
                assert caught.value.is_timeout

                pages = await browser.pages()
                assert page in pages
            finally:
                await browser.close()
            process = bridge.process
        assert await asyncio.wait_for(process.wait(), 10) == 0

    await asyncio.wait_for(exercise(), 120)
