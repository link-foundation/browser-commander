"""Opt-in session-cookie persistence for an explicit dedicated profile."""

import asyncio
from pathlib import Path

from browser_commander.browser.storage_state import (
    load_storage_state,
    restore_storage_state,
    save_storage_state,
    write_restricted_state,
)
from browser_commander.browser.system_browser import assert_dedicated_user_data_dir


def session_persistence_path(options):
    if not options.persist_session_cookies:
        return None
    if not options.user_data_dir:
        raise ValueError(
            "persist_session_cookies requires an explicit dedicated user_data_dir"
        )
    assert_dedicated_user_data_dir(options.user_data_dir)
    return (
        Path(options.persist_session_cookies)
        if isinstance(options.persist_session_cookies, (str, Path))
        else Path(options.user_data_dir) / "browser-commander-session.json"
    )


async def install_session_persistence(result, options):
    path = session_persistence_path(options)
    if path is None or getattr(result, "_session_persistence", False):
        return result
    if path.exists():
        await restore_storage_state(
            options.engine, result.browser, result.page, load_storage_state(path)
        )
    original_close = result.close
    closed = False
    close_lock = asyncio.Lock()

    async def close(*_args, **_kwargs):
        nonlocal closed
        async with close_lock:
            if closed:
                return
            closed = True
            try:
                state = await save_storage_state(
                    options.engine, result.browser, result.page
                )
                write_restricted_state(
                    path,
                    {
                        "cookies": [
                            cookie
                            for cookie in state["cookies"]
                            if not cookie.get("expires", -1) > 0
                        ],
                        "origins": [],
                    },
                )
            finally:
                await original_close()

    result.close = close
    if hasattr(result.browser, "close"):
        result.browser.close = close
    result._session_persistence = True
    return result
