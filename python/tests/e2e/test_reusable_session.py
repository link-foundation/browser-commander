# feature-parity: elements.reusable@native-typed sessions.runtime@native-typed sessions.workflow@native-typed
"""Authored local data pages and artificial cross-origin cookies only."""

import os

import pytest

from browser_commander import (
    LaunchOptions,
    launch_browser,
    make_browser_commander,
    save_storage_state,
)

pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(os.environ.get("RUN_E2E") != "true", reason="set RUN_E2E=true"),
]


async def test_reusable_helpers_and_context_cookies():
    from playwright.async_api import async_playwright

    async with async_playwright() as driver:
        browser = await driver.chromium.launch(headless=True, args=["--no-sandbox"])
        try:
            page = await browser.new_page()
            await page.goto(
                "data:text/html,<p>Hello%26nbsp%3B%20%20world</p><button class='pick disabled'>No</button><button class='pick'>Yes</button><input type='checkbox' id='checkbox'>"
            )
            commander = make_browser_commander(page=page)
            try:
                assert (
                    await commander.find_first(["#absent", "#checkbox"], visible=True)
                    == "#checkbox"
                )
                assert await commander.has_text(
                    ["Hello world"], normalize_whitespace=True
                )
                assert not await commander.is_enabled(".pick", index=0)
                assert await commander.is_enabled(".pick", index=1)
                assert (await commander.check("#checkbox"))["changed"]
                assert not (await commander.check("#checkbox"))["changed"]
                await commander.set_cookies(
                    [
                        {
                            "name": "session",
                            "value": "artificial",
                            "domain": "example.test",
                            "path": "/",
                            "expires": 0,
                            "httpOnly": True,
                            "sameSite": "lax",
                        },
                        {
                            "name": "keep",
                            "value": "artificial",
                            "domain": "notexample.test",
                            "path": "/",
                        },
                    ]
                )
                cookies = (await save_storage_state("playwright", browser, page))[
                    "cookies"
                ]
                assert (
                    next(cookie for cookie in cookies if cookie["name"] == "session")[
                        "expires"
                    ]
                    == -1
                )
                assert await commander.clear_cookies("example.test") == 1
                assert [
                    cookie["name"]
                    for cookie in (
                        await save_storage_state("playwright", browser, page)
                    )["cookies"]
                ] == ["keep"]
            finally:
                await commander.destroy()
        finally:
            await browser.close()


async def test_session_cookie_persistence_across_engine_launches(tmp_path):
    options = LaunchOptions(
        engine="playwright",
        launch="engine",
        headless=True,
        user_data_dir=str(tmp_path),
        persist_session_cookies=True,
        args=["--no-sandbox"],
    )
    result = await launch_browser(options)
    try:
        await result.page.context.add_cookies(
            [
                {
                    "name": "session",
                    "value": "artificial",
                    "domain": "example.test",
                    "path": "/",
                    "expires": -1,
                    "httpOnly": True,
                }
            ]
        )
    finally:
        await result.close()
    result = await launch_browser(options)
    try:
        cookies = await result.page.context.cookies()
        assert (
            next(cookie for cookie in cookies if cookie["name"] == "session")["value"]
            == "artificial"
        )
    finally:
        await result.close()
