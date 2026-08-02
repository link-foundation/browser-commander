"""Unit tests for browser launcher."""

from __future__ import annotations

from browser_commander.browser.launcher import LaunchOptions, resolve_chrome_args
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

    def test_extra_args_and_ignored_defaults_are_stored(self):
        options = LaunchOptions(
            extra_args=["--lang=en-US"],
            ignore_default_args=["--no-default-browser-check"],
        )
        assert options.extra_args == ["--lang=en-US"]
        assert options.ignore_default_args == ["--no-default-browser-check"]

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
        assert "--password-store=basic" in CHROME_ARGS
        assert "--no-first-run" in CHROME_ARGS
        assert "--no-default-browser-check" in CHROME_ARGS

    def test_resolves_additive_args_and_per_flag_opt_out(self):
        args = resolve_chrome_args(
            args=["--legacy-arg"],
            extra_args=["--lang=en-US"],
            ignore_default_args=["--no-default-browser-check"],
        )

        assert "--password-store=basic" in args
        assert "--no-first-run" in args
        assert "--no-default-browser-check" not in args
        assert args[-2:] == ["--legacy-arg", "--lang=en-US"]

    def test_can_ignore_all_defaults(self):
        assert resolve_chrome_args(
            extra_args=["--lang=en-US"], ignore_default_args=True
        ) == ["--lang=en-US"]

    def test_can_ignore_password_store_default_specifically(self):
        args = resolve_chrome_args(ignore_default_args=["--password-store=basic"])

        assert "--password-store=basic" not in args
        assert "--no-first-run" in args
