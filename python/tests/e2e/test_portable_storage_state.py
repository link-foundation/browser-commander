"""Round-trip a signed-in session between the two real Python engines.

Run with ``RUN_E2E=true CHROME_NO_SANDBOX=true xvfb-run -a pytest
tests/e2e/test_portable_storage_state.py -m e2e`` on Linux.
"""

from __future__ import annotations

import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from typing import TYPE_CHECKING

import pytest

from browser_commander import LaunchOptions, launch_browser, save_storage_state
from browser_commander.browser.system_browser import resolve_system_browser_executable

if TYPE_CHECKING:
    from pathlib import Path


def _skip_reason() -> str | None:
    if os.environ.get("RUN_E2E", "").lower() not in {"1", "true", "yes"}:
        return "set RUN_E2E=true to run real-browser end-to-end tests"
    try:
        resolve_system_browser_executable()
    except (FileNotFoundError, OSError) as error:
        return f"no installed Chrome: {error}"
    if sys.platform.startswith("linux") and not os.environ.get("DISPLAY"):
        return "a headful launch needs a display; run under xvfb-run -a"
    return None


pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(_skip_reason() is not None, reason=_skip_reason() or ""),
]


class _PageHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        body = b"<!doctype html><title>session</title>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        pass


@pytest.mark.parametrize(
    ("source_engine", "target_engine"),
    [("playwright", "selenium"), ("selenium", "playwright")],
)
async def test_portable_state_crosses_real_engines(
    source_engine: str, target_engine: str, tmp_path: Path
) -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _PageHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/"
    state_path = tmp_path / "session.json"
    args = ["--no-sandbox"] if os.environ.get("CHROME_NO_SANDBOX") == "true" else []

    async def navigate(engine: str, page: object) -> None:
        if engine == "playwright":
            await page.goto(url)
        else:
            page.get(url)

    async def evaluate(engine: str, page: object, script: str) -> object:
        if engine == "playwright":
            return await page.evaluate(script)
        return page.execute_script(f"return ({script})();")

    try:
        source = await launch_browser(LaunchOptions(engine=source_engine, args=args))
        try:
            await navigate(source_engine, source.page)
            await evaluate(
                source_engine,
                source.page,
                "() => { localStorage.setItem('theme', 'dark'); "
                "document.cookie = 'session=saved; SameSite=Lax'; }",
            )
            state = await save_storage_state(
                source_engine, source.browser, source.page, state_path
            )
            assert state["cookies"]
            assert state_path.exists()
        finally:
            assert source.close is not None
            await source.close()

        target = await launch_browser(
            LaunchOptions(engine=target_engine, args=args, storage_state=state_path)
        )
        try:
            await navigate(target_engine, target.page)
            restored = await evaluate(
                target_engine,
                target.page,
                "() => ({ theme: localStorage.getItem('theme'), "
                "cookie: document.cookie })",
            )
            assert restored["theme"] == "dark"
            assert "session=saved" in restored["cookie"]
        finally:
            assert target.close is not None
            await target.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
