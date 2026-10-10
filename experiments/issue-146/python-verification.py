"""Exercise capture, network redaction and persistent sessions against Chromium."""

import asyncio
import io
import json
import os
import socket
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image
from playwright.async_api import async_playwright

from browser_commander import connect_or_launch
from browser_commander.capture import encode_animation, screenshot, start_recording
from browser_commander.traces import read_trace, start_trace


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Set-Cookie", "fixture=" + "private")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, *_args):
        pass


async def main():
    scratch = tempfile.TemporaryDirectory()
    output = scratch.name
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True, args=["--no-sandbox"])
            try:
                page = await browser.new_page(viewport={"width": 320, "height": 200})
                await page.set_content('<button>Capture</button><input value="caret">')
                before = await page.locator("body").inner_html()
                first = await screenshot(page, hide_caret=True, hide_scrollbars=True)
                assert await page.locator("body").inner_html() == before
                await page.locator("button").evaluate("el => el.style.color = 'red'")
                second = await screenshot(page)
                for fmt in ("gif", "apng", "webp"):
                    data = encode_animation([first, second], format=fmt)
                    with Image.open(io.BytesIO(data)) as image:
                        assert image.n_frames == 2 and image.size == (320, 200)
                    print(fmt, len(data))
                recorder = await start_recording(page, format="webm", max_frames=2)
                await asyncio.sleep(0.2)
                recording = await recorder.stop()
                assert recording["bytes"][:4] == b"\x1aE\xdf\xa3"
                trace = await start_trace(
                    page=page, output=Path(output) / "trace", mode="continuous",
                    network={"har": True, "bodies": True, "max_body_bytes": 8},
                    links={"output": str(Path(output) / "trace.lino"), "dom": "text"},
                )
                url = f"http://127.0.0.1:{server.server_port}"
                await page.goto(url)
                await page.evaluate("fetch('/', {headers:{Authorization:'fixture-'+'private'}})")
                await trace.stop()
                events = read_trace(Path(output) / "trace").events
                assert any(event["kind"] == "network.response" for event in events)
                har = json.loads((Path(output) / "trace/network.har").read_text())
                assert har["log"]["entries"]
                assert "fixture-private" not in json.dumps(events)
                assert "fixture=private" not in json.dumps(har)
                print("network HAR, bounded bodies and credential redaction verified")
            finally:
                await browser.close()
            with socket.socket() as reservation:
                reservation.bind(("127.0.0.1", 0))
                port = reservation.getsockname()[1]
            options = dict(
                user_data_dir=str(Path(output) / "profile"),
                remote_debugging_port=port, idle_timeout_ms=30000,
                executable_path=pw.chromium.executable_path,
                headless=True, args=["--no-sandbox"],
            )
            session = await connect_or_launch(**options)
            try:
                await session.page.goto("data:text/html,<p>remembered python tab</p>")
                await session.detach()
                session = await connect_or_launch(**options)
                assert session.reused and "remembered" in session.page.url
                print("persistent detach/reconnect verified")
            finally:
                await session.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
        scratch.cleanup()


if __name__ == "__main__":
    os.environ.setdefault("BROWSER_COMMANDER_JS_CLI", str(Path("js/bin/browser-commander.js").resolve()))
    asyncio.run(main())
