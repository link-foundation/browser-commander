"""Unit tests for browser launcher."""

from __future__ import annotations

import pytest

from browser_commander.browser.launcher import (
    LAUNCH_MODES,
    LaunchOptions,
    resolve_chrome_args,
    resolve_ignored_default_args,
    selenium_excluded_switches,
)
from browser_commander.browser.restrictions import resolve_restrictions
from browser_commander.core.constants import CHROME_ARGS
from browser_commander.fingerprint.automation_parity import (
    AUTOMATION_CONTROLLED_OFF_ARG,
    PLAYWRIGHT_HEADLESS_POINTER_ARG,
    PLAYWRIGHT_SOFTWARE_WEBGL_ARG,
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

    def test_slow_mo_defaults_to_zero(self):
        # Issue #103: no artificial delay unless the caller asks for one.
        assert LaunchOptions().slow_mo == 0

    def test_launches_the_real_browser_by_default(self):
        assert LaunchOptions().launch == "real"
        assert LAUNCH_MODES == ("real", "engine")

    def test_adds_no_restrictions_by_default(self):
        options = LaunchOptions()
        assert options.restrictions == []
        assert options.env is None
        assert options.user_data_dir is None
        assert options.remote_debugging_port is None


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

    def test_chrome_args_equal_the_legacy_defaults_preset(self):
        # CHROME_ARGS is no longer added by default (issue #103); it is kept as
        # the legacy-defaults restriction preset.
        assert set(CHROME_ARGS) == set(resolve_restrictions(["legacy-defaults"]).args)

    def test_resolves_nothing_by_default(self):
        assert resolve_chrome_args() == []

    def test_resolves_restrictions_then_args(self):
        args = resolve_chrome_args(
            restrictions=["no-sync", "no-translate"],
            args=["--legacy-arg", "--disable-features=Foo"],
            extra_args=["--lang=en-US"],
        )

        assert args == [
            "--disable-sync",
            "--disable-features=Translate,Foo",
            "--legacy-arg",
            "--lang=en-US",
        ]

    def test_legacy_defaults_restore_the_old_command_line(self):
        assert set(resolve_chrome_args(restrictions=["legacy-defaults"])) == set(
            CHROME_ARGS
        )

    def test_rejects_an_unknown_restriction(self):
        with pytest.raises(ValueError, match='Unknown launch restriction "nope"'):
            resolve_chrome_args(restrictions=["nope"])


class TestAutomationParity:
    """Launch options close the measured gap by default."""

    def test_automation_parity_is_on_by_default(self):
        options = LaunchOptions()
        assert options.automation_parity is True

    def test_automation_parity_can_be_turned_off(self):
        options = LaunchOptions(automation_parity=False)
        assert options.automation_parity is False

    def test_no_fingerprint_is_applied_unless_one_is_given(self):
        # A launch without a profile has to leave the machine as it is, so the
        # browser reports the real hardware rather than a half-set one.
        assert LaunchOptions().fingerprint is None

    def test_carries_the_fingerprint_profile_to_apply_after_launch(self):
        options = LaunchOptions(fingerprint={"timezoneId": "Europe/Berlin"})
        assert options.fingerprint == {"timezoneId": "Europe/Berlin"}


class TestResolveIgnoredDefaultArgs:
    """Parity exclusions merge with the caller's own."""

    def test_playwright_excludes_the_automation_switch(self):
        assert resolve_ignored_default_args("playwright") == [
            "--enable-automation",
            PLAYWRIGHT_SOFTWARE_WEBGL_ARG,
        ]

    def test_playwright_headless_also_excludes_the_pointer_switch(self):
        assert resolve_ignored_default_args("playwright", headless=True) == [
            "--enable-automation",
            PLAYWRIGHT_SOFTWARE_WEBGL_ARG,
            PLAYWRIGHT_HEADLESS_POINTER_ARG,
        ]

    def test_caller_exclusions_are_appended_without_duplicates(self):
        assert resolve_ignored_default_args(
            "playwright",
            ignore_default_args=["--enable-automation", "--no-first-run"],
        ) == [
            "--enable-automation",
            PLAYWRIGHT_SOFTWARE_WEBGL_ARG,
            "--no-first-run",
        ]

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
        assert args == [AUTOMATION_CONTROLLED_OFF_ARG]
