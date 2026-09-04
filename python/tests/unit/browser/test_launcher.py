"""Unit tests for browser launcher."""

from __future__ import annotations

from browser_commander.browser.launcher import (
    LaunchOptions,
    resolve_chrome_args,
    resolve_ignored_default_args,
    selenium_excluded_switches,
)
from browser_commander.core.constants import CHROME_ARGS
from browser_commander.fingerprint.automation_parity import (
    AUTOMATION_CONTROLLED_OFF_ARG,
    PLAYWRIGHT_HEADLESS_POINTER_ARG,
    apply_automation_parity_args,
)


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


class TestAutomationParity:
    """Launch options close the measured gap by default."""

    def test_automation_parity_is_on_by_default(self):
        options = LaunchOptions()
        assert options.automation_parity is True

    def test_automation_parity_can_be_turned_off(self):
        options = LaunchOptions(automation_parity=False)
        assert options.automation_parity is False


class TestResolveIgnoredDefaultArgs:
    """Parity exclusions merge with the caller's own."""

    def test_playwright_excludes_the_automation_switch(self):
        assert resolve_ignored_default_args("playwright") == ["--enable-automation"]

    def test_playwright_headless_also_excludes_the_pointer_switch(self):
        assert resolve_ignored_default_args("playwright", headless=True) == [
            "--enable-automation",
            PLAYWRIGHT_HEADLESS_POINTER_ARG,
        ]

    def test_caller_exclusions_are_appended_without_duplicates(self):
        assert resolve_ignored_default_args(
            "playwright",
            ignore_default_args=["--enable-automation", "--no-first-run"],
        ) == ["--enable-automation", "--no-first-run"]

    def test_true_is_forwarded_unchanged(self):
        assert (
            resolve_ignored_default_args("playwright", ignore_default_args=True) is True
        )

    def test_parity_off_keeps_only_the_caller_exclusions(self):
        assert resolve_ignored_default_args(
            "playwright",
            ignore_default_args=["--no-first-run"],
            automation_parity=False,
        ) == ["--no-first-run"]

    def test_parity_off_excludes_nothing_by_default(self):
        assert resolve_ignored_default_args("playwright", automation_parity=False) == []


class TestSeleniumExcludedSwitches:
    """ChromeDriver matches switch names without the leading dashes."""

    def test_strips_the_leading_dashes(self):
        assert selenium_excluded_switches(["--enable-automation"]) == [
            "enable-automation"
        ]

    def test_drops_the_value_of_a_valued_switch(self):
        assert selenium_excluded_switches(["--blink-settings=primaryHoverType=2"]) == [
            "blink-settings"
        ]

    def test_removes_duplicates_created_by_stripping_values(self):
        assert selenium_excluded_switches(["--foo=1", "--foo=2"]) == ["foo"]

    def test_empty_for_no_exclusions(self):
        assert selenium_excluded_switches([]) == []

    def test_empty_when_every_default_is_ignored(self):
        # "ignore everything" is not a list of switch names ChromeDriver can match.
        assert selenium_excluded_switches(True) == []


class TestChromeArgsWithParity:
    """The resolved command line disables the Blink feature."""

    def test_defaults_gain_the_parity_switch(self):
        args = apply_automation_parity_args(resolve_chrome_args())
        assert args[: len(CHROME_ARGS)] == CHROME_ARGS
        assert args[-1] == AUTOMATION_CONTROLLED_OFF_ARG
