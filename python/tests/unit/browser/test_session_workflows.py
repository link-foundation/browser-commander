"""Portable session normalization, snapshot cleanup and explicit persistence."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from browser_commander import clear_cookies, find_site_sessions, set_cookies
from browser_commander.browser.real_browser import RealBrowserOptions
from browser_commander.browser.session_cookies import normalize_session_cookies
from browser_commander.browser.session_persistence import (
    install_session_persistence,
    session_persistence_path,
)


@pytest.mark.parametrize("browser", ["firefox", "safari"])
async def test_non_chromium_discovery_uses_existing_database_reader(
    monkeypatch, browser
):
    from browser_commander.browser import browser_cookies

    read = []

    def reader(options):
        read.append(options)
        return [
            {"name": "session", "domain": ".example.test"},
            {"domain": "notexample.test"},
        ]

    monkeypatch.setattr(browser_cookies, "read_browser_cookies", reader)
    results = await find_site_sessions(
        domains=["example.test"],
        sources=[{"browser": browser, "path": "/artificial/profile"}],
    )
    assert len(read) == 1
    assert read[0].via == "database" and read[0].cache is False
    assert len(results[0]["cookies"]) == 1
    assert results[0]["logged_in"] is None
    assert "error" not in results[0]


async def test_non_chromium_validation_seeds_and_closes_disposable_browser(monkeypatch):
    from browser_commander.browser import browser_cookies, launcher

    context = SimpleNamespace(add_cookies=AsyncMock())
    close = AsyncMock()
    launch = AsyncMock(
        return_value=SimpleNamespace(
            browser=context, page=SimpleNamespace(context=context), close=close
        )
    )
    monkeypatch.setattr(
        browser_cookies,
        "read_browser_cookies",
        lambda _options: [
            {
                "name": "session",
                "value": "artificial",
                "domain": "example.test",
                "path": "/",
            }
        ],
    )
    monkeypatch.setattr(launcher, "launch_browser", launch)
    results = await find_site_sessions(
        domains=["example.test"],
        sources=[{"browser": "firefox", "path": "/artificial/profile"}],
        is_logged_in=AsyncMock(return_value=True),
    )
    assert launch.await_args.args[0].launch == "engine"
    assert launch.await_args.args[0].user_data_dir is None
    context.add_cookies.assert_awaited_once()
    close.assert_awaited_once()
    assert results[0]["logged_in"] is True


def test_session_expiry_and_same_site():
    for engine in ("playwright", "selenium"):
        values = normalize_session_cookies(
            [{"expires": 0, "sameSite": "lax"}, {"expires": 123}], engine
        )
        assert values[0].get("expires", -1) == -1
        assert values[0]["sameSite"] == "Lax"
        assert values[1]["expires"] == 123


async def test_context_cookies_respect_domain_boundaries():
    context = SimpleNamespace(
        add_cookies=AsyncMock(),
        cookies=AsyncMock(
            return_value=[
                {"name": "session", "domain": ".example.test", "path": "/"},
                {"name": "keep", "domain": "notexample.test", "path": "/"},
            ]
        ),
        clear_cookies=AsyncMock(),
    )
    page = SimpleNamespace(context=context)
    await set_cookies(
        page,
        "playwright",
        [
            {
                "name": "session",
                "value": "artificial",
                "domain": "example.test",
                "path": "/",
                "expires": 0,
            }
        ],
    )
    assert context.add_cookies.await_args.args[0][0]["expires"] == -1
    assert await clear_cookies(page, "playwright", "example.test") == 1
    context.clear_cookies.assert_awaited_once_with(
        name="session", domain=".example.test", path="/"
    )


async def test_validation_failure_closes_cookie_only_snapshot():
    close = AsyncMock()
    context = SimpleNamespace(
        storage_state=AsyncMock(return_value={"cookies": [], "origins": []})
    )
    result = SimpleNamespace(
        browser=context, page=SimpleNamespace(context=context), close=close
    )
    launch = AsyncMock(return_value=result)
    results = await find_site_sessions(
        domains=["example.test"],
        sources=[{"browser": "chrome", "path": "/artificial/Default"}],
        launch=launch,
        is_logged_in=AsyncMock(side_effect=ValueError("artificial validator failure")),
    )
    assert launch.await_args.args[0].include == ["cookies"]
    close.assert_awaited_once()
    assert "validator failure" in results[0]["error"]


async def test_persistence_is_explicit_session_only_and_owner_only(tmp_path):
    with pytest.raises(ValueError, match="dedicated"):
        session_persistence_path(RealBrowserOptions(persist_session_cookies=True))
    context = SimpleNamespace(
        storage_state=AsyncMock(
            return_value={
                "cookies": [
                    {"name": "session", "expires": -1},
                    {"name": "persistent", "expires": 9999999999},
                ],
                "origins": [],
            }
        )
    )
    close = AsyncMock()
    result = SimpleNamespace(
        browser=context, page=SimpleNamespace(context=context), close=close
    )
    await install_session_persistence(
        result,
        RealBrowserOptions(user_data_dir=str(tmp_path), persist_session_cookies=True),
    )
    await result.close()
    await result.close()
    close.assert_awaited_once()
    import json

    state = tmp_path / "browser-commander-session.json"
    assert json.loads(state.read_text())["cookies"] == [
        {"name": "session", "expires": -1}
    ]
    if __import__("sys").platform != "win32":
        assert state.stat().st_mode & 0o777 == 0o600


def test_modern_macos_default_browser():
    from browser_commander.browser.default_browser import resolve_default_browser

    assert (
        resolve_default_browser(
            platform="darwin",
            run_command=lambda command, _args, _env: (
                "com.google.chrome" if command == "osascript" else "()"
            ),
        )
        == "chrome"
    )
    assert (
        resolve_default_browser(
            platform="darwin", run_command=lambda _command, _args, _env: ""
        )
        is None
    )


async def test_session_discovery_continues_after_close_failure():
    context = SimpleNamespace(
        storage_state=AsyncMock(return_value={"cookies": [], "origins": []})
    )
    close = AsyncMock(side_effect=RuntimeError("artificial close failure"))
    results = await find_site_sessions(
        domains=["example.test"],
        sources=[
            {"browser": "chrome", "path": "/artificial/Default"},
            {"browser": "chrome", "path": "/artificial/Profile 1"},
        ],
        launch=AsyncMock(
            return_value=SimpleNamespace(
                page=SimpleNamespace(context=context), browser=context, close=close
            )
        ),
    )
    assert len(results) == 2
    assert close.await_count == 2
    assert all("close failure" in result["error"] for result in results)


def test_unsubscribe_does_not_remove_another_registration_of_the_same_callback():
    from browser_commander.core.subscriptions import subscribe_callbacks

    callbacks = []

    def callback():
        pass

    first = subscribe_callbacks(callbacks, callback)
    second = subscribe_callbacks(callbacks, callback)
    first()
    first()
    assert callbacks == [callback]
    second()
    assert callbacks == []
