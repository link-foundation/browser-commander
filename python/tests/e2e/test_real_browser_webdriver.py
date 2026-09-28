"""A real launch must look like a person's browser to the page (#101, #103).

Opt-in, like the JavaScript end-to-end suites. It needs ``RUN_E2E=true``, an
installed Chrome and, on Linux, a display::

    RUN_E2E=true xvfb-run -a pytest tests/e2e -m e2e

``CHROME_NO_SANDBOX=true`` adds ``--no-sandbox`` for containers that forbid
unprivileged user namespaces.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

from browser_commander import LaunchOptions, launch_browser
from browser_commander.browser.system_browser import (
    resolve_system_browser_executable,
)
from browser_commander.fingerprint.automation_parity import (
    detect_automation_controlled_triggers,
)


def _skip_reason() -> str | None:
    if os.environ.get("RUN_E2E", "").lower() not in {"1", "true", "yes"}:
        return "set RUN_E2E=true to run the real-browser end-to-end tests"
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

SANDBOX_ARGS = ["--no-sandbox"] if os.environ.get("CHROME_NO_SANDBOX") == "true" else []


@pytest.mark.parametrize("engine", ["playwright", "selenium"])
async def test_real_launch_is_not_reported_as_automated(engine: str) -> None:
    result = await launch_browser(
        LaunchOptions(engine=engine, headless=False, args=SANDBOX_ARGS)  # type: ignore[arg-type]
    )
    user_data_dir = result.user_data_dir
    try:
        assert result.launch == "real"
        assert result.temporary_profile is True
        assert detect_automation_controlled_triggers(result.args) == []

        page = result.page
        if engine == "playwright":
            await page.goto("data:text/html,<title>real</title>")
            webdriver = await page.evaluate("() => navigator.webdriver")
        else:
            page.get("data:text/html,<title>real</title>")
            webdriver = page.execute_script("return navigator.webdriver")
        assert webdriver is False
    finally:
        assert result.close is not None
        await result.close()

    # The temporary profile is deleted with the browser.
    assert user_data_dir is not None
    assert not Path(user_data_dir).exists()
