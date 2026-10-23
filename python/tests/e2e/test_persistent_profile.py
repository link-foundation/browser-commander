"""A persistent profile keeps session cookies across a normal restart (#187).

Log in on one launch, ``close()``, launch the same ``user_data_dir`` again and
the cookie without an expiry date is still sent. ``keep_session_cookies=False``
loses it, and a temporary profile launches as before.

    RUN_E2E=true CHROME_NO_SANDBOX=true \\
        pytest tests/e2e/test_persistent_profile.py
"""

# feature-parity: profile.session-cookies@native-typed

from __future__ import annotations

import asyncio
import os
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import Any

import pytest

from browser_commander import LaunchOptions, connect_or_launch, launch_browser
from browser_commander.browser.debugging_port import reserve_loopback_port

pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(
        os.environ.get("RUN_E2E") != "true", reason="set RUN_E2E=true to run browsers"
    ),
]

CHROME = os.environ.get("CHROME_PATH", "/usr/bin/google-chrome")
ARGS = ["--no-sandbox"] if os.environ.get("CHROME_NO_SANDBOX") == "true" else []
LAUNCHES = [
    ("playwright", "real"),
    ("playwright", "engine"),
    ("selenium", "real"),
    ("selenium", "engine"),
]


class _SessionCookieHost(BaseHTTPRequestHandler):
    """``/login`` sets a session cookie: no ``Expires`` and no ``Max-Age``."""

    def do_GET(self) -> None:
        body = f"<!doctype html><title>{self.path}</title>".encode()
        self.send_response(200)
        if self.path == "/login":
            self.send_header("Set-Cookie", "sid=logged-in; Path=/")
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        pass


@pytest.fixture(scope="module")
def base_url() -> Iterator[str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _SessionCookieHost)
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()


def _engine(session: Any) -> str:
    return "playwright" if hasattr(session.page, "context") else "selenium"


async def _visit(session: Any, url: str) -> str:
    """Open ``url`` and return the page's ``document.cookie``."""

    if _engine(session) == "playwright":
        await session.page.goto(url)
        return await session.page.evaluate("() => document.cookie")
    session.page.get(url)
    return session.page.execute_script("return document.cookie")


async def _open_tab(session: Any) -> None:
    script = "window.open('/other', '_blank')"
    if _engine(session) == "playwright":
        await session.page.evaluate(f"() => {{ {script}; }}")
    else:
        session.page.execute_script(script)


def _tabs(session: Any) -> int:
    if _engine(session) == "playwright":
        return len(session.page.context.pages)
    return len(session.page.window_handles)


async def _restart(base_url: str, launch: Any, options: LaunchOptions) -> Any:
    """Log in on one launch, restart, and report what the second one sees."""

    async def run() -> Any:
        first = await launch(options)
        try:
            assert await _visit(first, f"{base_url}/login") == "sid=logged-in"
            # A second tab, which the next launch must not reopen by default.
            await _open_tab(first)
        finally:
            await first.close()
        second = await launch(options)
        try:
            cookie = await _visit(second, f"{base_url}/check")
            return second, cookie, _tabs(second)
        finally:
            await second.close()

    return await asyncio.wait_for(run(), timeout=120)


def _options(engine: str, launch: str, **settings: Any) -> LaunchOptions:
    return LaunchOptions(
        engine=engine,
        launch=launch,
        headless=True,
        executable_path=CHROME,
        args=ARGS,
        **settings,
    )


@pytest.mark.parametrize(("engine", "launch"), LAUNCHES)
async def test_the_session_cookie_survives_close_and_relaunch(
    engine: str, launch: str, base_url: str, tmp_path: Path
) -> None:
    second, cookie, tabs = await _restart(
        base_url, launch_browser, _options(engine, launch, user_data_dir=str(tmp_path))
    )
    assert cookie == "sid=logged-in"
    assert second.keep_session_cookies is True
    assert second.warnings == []
    assert tabs == 1, "the last session tabs are not restored"


@pytest.mark.parametrize(("engine", "launch"), LAUNCHES)
async def test_keep_session_cookies_false_loses_it(
    engine: str, launch: str, base_url: str, tmp_path: Path
) -> None:
    second, cookie, _ = await _restart(
        base_url,
        launch_browser,
        _options(
            engine, launch, user_data_dir=str(tmp_path), keep_session_cookies=False
        ),
    )
    assert cookie == ""
    assert second.keep_session_cookies is False


@pytest.mark.parametrize(("engine", "launch"), LAUNCHES)
async def test_a_temporary_profile_launches_as_before(
    engine: str, launch: str, base_url: str
) -> None:
    second, cookie, _ = await _restart(
        base_url, launch_browser, _options(engine, launch)
    )
    # Each launch has its own empty profile, deleted on close.
    assert cookie == ""
    assert second.temporary_profile is True
    assert second.keep_session_cookies is False
    assert not any(
        argument == "--restore-last-session" or "SessionRestoreInfobar" in argument
        for argument in second.args
    )


async def test_restore_tabs_reopens_the_last_session_tabs_with_the_cookie(
    base_url: str, tmp_path: Path
) -> None:
    _, cookie, tabs = await _restart(
        base_url,
        launch_browser,
        _options("playwright", "real", user_data_dir=str(tmp_path), restore_tabs=True),
    )
    assert cookie == "sid=logged-in"
    assert tabs > 1, f"restored tabs: {tabs}"


async def test_connect_or_launch_keeps_the_session_cookie(
    base_url: str, tmp_path: Path
) -> None:
    second, cookie, tabs = await _restart(
        base_url,
        connect_or_launch,
        _options(
            "playwright",
            "real",
            user_data_dir=str(tmp_path),
            remote_debugging_port=reserve_loopback_port(),
        ),
    )
    assert cookie == "sid=logged-in"
    assert second.keep_session_cookies is True
    assert tabs == 1
