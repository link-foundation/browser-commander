"""Opt-in macOS smoke test against a local page and native Selenium commands."""

import asyncio
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest

from browser_commander import (
    RealBrowserOptions,
    SafariUnsupportedError,
    launch_real_browser,
)
from browser_commander.core.engine_adapter import SeleniumAdapter


@pytest.mark.e2e
@pytest.mark.skipif(
    sys.platform != "darwin" or os.environ.get("RUN_SAFARI_E2E") != "true",
    reason="requires opted-in macOS Safari",
)
async def test_safari_native_commands_and_isolation():
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(
                b'<title>Safari smoke</title><input id="name"><button id="go" onclick="document.querySelector(\'#out\').textContent=document.querySelector(\'#name\').value">Go</button><p id="out"></p>'
            )

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/"
    session = None
    try:
        session = await asyncio.wait_for(
            launch_real_browser(
                RealBrowserOptions(
                    channel="safari",
                    seed_cookies=[
                        {"name": "seed", "value": "yes", "url": url, "httpOnly": True}
                    ],
                )
            ),
            30,
        )
        driver = session.page
        adapter = SeleniumAdapter(driver)
        await adapter.goto(url, timeout=10_000)
        driver.find_element("css selector", "#name").send_keys("Safari")
        driver.find_element("css selector", "#go").click()
        assert (
            await adapter.evaluate_on_page(
                "() => document.querySelector('#out').textContent"
            )
            == "Safari"
        )
        assert (
            driver.execute_async_script(
                "const done=arguments[arguments.length-1]; Promise.resolve(5).then(done)"
            )
            == 5
        )
        assert len(driver.get_screenshot_as_png()) > 100
        assert driver.get_cookie("seed")["value"] == "yes"
        initial = driver.current_window_handle
        for kind in ("tab", "window"):
            driver.switch_to.new_window(kind)
            assert driver.current_window_handle != initial
            driver.get(url)
            driver.close()
            driver.switch_to.window(initial)
        with pytest.raises(SafariUnsupportedError):
            await adapter.pdf()
        await session.close()
        session = await launch_real_browser(RealBrowserOptions(channel="safari"))
        session.page.get(url)
        assert session.page.get_cookie("seed") is None
    finally:
        if session is not None:
            await session.close()
        server.shutdown()
        server.server_close()
        thread.join()
