"""Stable, redacted launch failures, independent of browser error wording."""

import sys

import pytest

from browser_commander.browser.launch_diagnostics import BrowserLaunchError
from browser_commander.browser.real_browser import (
    RealBrowserOptions,
    launch_real_browser,
)


async def test_bad_executable_preserves_stderr_and_cleanup():
    with pytest.raises(BrowserLaunchError) as failure:
        await launch_real_browser(
            RealBrowserOptions(
                executable_path=sys.executable, headless=True, startup_timeout=1000
            )
        )
    error = failure.value
    assert error.phase == "endpoint"
    assert error.category == "early_exit"
    assert error.exit_code is not None
    assert error.stderr_tail
    assert len(error.stderr_tail) <= 4096
    assert error.__cause__ is not None
    assert sys.executable not in str(error)


async def test_missing_executable_has_stable_category():
    with pytest.raises(BrowserLaunchError) as failure:
        await launch_real_browser(
            RealBrowserOptions(executable_path="/private/token-secret/no-browser")
        )
    assert failure.value.category == "missing_executable"
    assert "/private/token-secret" not in str(failure.value)
