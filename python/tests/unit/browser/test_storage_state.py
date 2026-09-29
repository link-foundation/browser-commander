"""Playwright-compatible cookie and localStorage state across Python engines."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from browser_commander.browser.storage_state import (
    load_storage_state,
    restore_storage_state,
    save_storage_state,
)

STATE = {
    "cookies": [
        {"name": "sid", "value": "saved", "domain": "example.test", "path": "/"}
    ],
    "origins": [
        {
            "origin": "https://example.test",
            "localStorage": [{"name": "theme", "value": "dark"}],
        }
    ],
}


# feature-parity: storage.portable@native-typed
@pytest.mark.asyncio
async def test_playwright_state_round_trip_from_file(tmp_path: Path) -> None:
    path = tmp_path / "state.json"
    path.write_text(json.dumps(STATE), encoding="utf-8")
    context = MagicMock()
    context.pages = []
    context.add_cookies = AsyncMock()
    context.add_init_script = AsyncMock()
    context.storage_state = AsyncMock(return_value=STATE)
    page = MagicMock(context=context)
    page.evaluate = AsyncMock()

    await restore_storage_state("playwright", context, page, path)

    context.add_cookies.assert_awaited_once_with(STATE["cookies"])
    script = context.add_init_script.call_args.kwargs["script"]
    assert "theme" in script
    assert "https://example.test" in script
    page.evaluate.assert_awaited_once_with(script)
    assert await save_storage_state("playwright", context, page) == STATE


@pytest.mark.asyncio
async def test_selenium_state_uses_cdp_and_exports_current_origin() -> None:
    driver = MagicMock()
    driver.current_url = "https://example.test/path"
    driver.get_cookies.return_value = [
        {
            "name": "sid",
            "value": "saved",
            "domain": "example.test",
            "path": "/",
            "expiry": 123,
        }
    ]
    driver.execute_script.return_value = [{"name": "theme", "value": "dark"}]

    await restore_storage_state("selenium", driver, driver, STATE)

    driver.execute_cdp_cmd.assert_any_call("Network.setCookie", STATE["cookies"][0])
    script = driver.execute_cdp_cmd.call_args_list[-1].args[1]["source"]
    assert "theme" in script
    driver.execute_script.assert_any_call(script)
    exported = await save_storage_state("selenium", driver, driver)
    assert exported["cookies"][0]["expires"] == 123
    assert exported["origins"] == [
        {
            "origin": "https://example.test",
            "localStorage": [{"name": "theme", "value": "dark"}],
        }
    ]


def test_state_rejects_invalid_shape_and_accepts_json_path(tmp_path: Path) -> None:
    path = tmp_path / "state.json"
    path.write_text(json.dumps(STATE), encoding="utf-8")
    assert load_storage_state(path) == STATE
    with pytest.raises(ValueError, match="cookies"):
        load_storage_state({"cookies": {}})
