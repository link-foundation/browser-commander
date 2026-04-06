"""Unit tests for browser launcher."""

from __future__ import annotations

from browser_commander.browser.launcher import LaunchOptions
from browser_commander.core.constants import CHROME_ARGS


class TestLaunchOptions:
    """Test LaunchOptions default values and validation."""

    def test_default_engine_is_playwright(self):
        options = LaunchOptions()
        assert options.engine == "playwright"

    def test_default_headless_is_false(self):
        options = LaunchOptions()
        assert options.headless is False

    def test_default_args_is_empty_list(self):
        options = LaunchOptions()
        assert options.args == []

    def test_custom_engine(self):
        options = LaunchOptions(engine="selenium")
        assert options.engine == "selenium"

    def test_custom_headless(self):
        options = LaunchOptions(headless=True)
        assert options.headless is True

    def test_custom_args_are_stored(self):
        custom_args = ["--disable-extensions", "--no-sandbox"]
        options = LaunchOptions(args=custom_args)
        assert options.args == custom_args

    def test_custom_user_data_dir(self):
        options = LaunchOptions(user_data_dir="/tmp/test-profile")
        assert options.user_data_dir == "/tmp/test-profile"

    def test_slow_mo_defaults_to_none(self):
        options = LaunchOptions()
        assert options.slow_mo is None


class TestChromeArgs:
    """Test Chrome arguments constants."""

    def test_chrome_args_is_list(self):
        assert isinstance(CHROME_ARGS, list)

    def test_chrome_args_not_empty(self):
        assert len(CHROME_ARGS) > 0

    def test_chrome_args_includes_expected_defaults(self):
        assert "--disable-session-crashed-bubble" in CHROME_ARGS
        assert "--no-first-run" in CHROME_ARGS
        assert "--no-default-browser-check" in CHROME_ARGS
