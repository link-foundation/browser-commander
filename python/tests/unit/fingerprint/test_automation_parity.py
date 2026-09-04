"""Unit tests for automation parity switches."""

from __future__ import annotations

import pytest

from browser_commander.fingerprint.automation_parity import (
    AUTOMATION_CONTROLLED_OFF_ARG,
    AUTOMATION_CONTROLLED_TRIGGERS,
    ENGINE_PARITY_IGNORED_DEFAULT_ARGS,
    PLAYWRIGHT_HEADLESS_POINTER_ARG,
    PLAYWRIGHT_SOFTWARE_WEBGL_ARG,
    apply_automation_parity_args,
    detect_automation_controlled_triggers,
    disables_automation_controlled,
    parity_ignored_default_args,
)


class TestTriggerTable:
    """The table mirrors content/child/runtime_features.cc."""

    def test_covers_every_switch_runtime_features_maps(self):
        switches = {trigger.switch for trigger in AUTOMATION_CONTROLLED_TRIGGERS}
        assert switches == {
            "--enable-automation",
            "--headless",
            "--remote-debugging-pipe",
            "--remote-debugging-port=0",
        }

    def test_every_trigger_explains_itself(self):
        for trigger in AUTOMATION_CONTROLLED_TRIGGERS:
            assert "runtime_features.cc" in trigger.reason


class TestDetectAutomationControlledTriggers:
    """Detection reports why navigator.webdriver would be true."""

    def test_no_triggers_in_plain_arguments(self):
        assert detect_automation_controlled_triggers(["--no-first-run"]) == []

    def test_defaults_to_no_arguments(self):
        assert detect_automation_controlled_triggers() == []

    def test_detects_enable_automation(self):
        found = detect_automation_controlled_triggers(["--enable-automation"])
        assert [trigger.switch for trigger in found] == ["--enable-automation"]
        assert found[0].argument == "--enable-automation"

    def test_detects_headless_with_a_value(self):
        found = detect_automation_controlled_triggers(["--headless=new"])
        assert [trigger.switch for trigger in found] == ["--headless"]
        assert found[0].argument == "--headless=new"

    def test_detects_remote_debugging_pipe(self):
        found = detect_automation_controlled_triggers(["--remote-debugging-pipe"])
        assert [trigger.switch for trigger in found] == ["--remote-debugging-pipe"]

    def test_detects_an_ephemeral_debugging_port(self):
        found = detect_automation_controlled_triggers(["--remote-debugging-port=0"])
        assert [trigger.switch for trigger in found] == ["--remote-debugging-port=0"]

    def test_leaves_a_fixed_debugging_port_alone(self):
        # runtime_features.cc exempts a specific port on purpose: that is what a
        # human attaching a debugger passes.
        assert (
            detect_automation_controlled_triggers(["--remote-debugging-port=9222"])
            == []
        )

    def test_ignores_a_debugging_port_that_is_not_a_number(self):
        assert (
            detect_automation_controlled_triggers(["--remote-debugging-port=auto"])
            == []
        )

    def test_does_not_match_a_switch_that_merely_starts_the_same(self):
        assert (
            detect_automation_controlled_triggers(["--enable-automation-extra"]) == []
        )

    def test_reports_every_trigger_in_order(self):
        found = detect_automation_controlled_triggers(
            ["--headless", "--no-first-run", "--remote-debugging-pipe"]
        )
        assert [trigger.switch for trigger in found] == [
            "--headless",
            "--remote-debugging-pipe",
        ]

    def test_rejects_a_bare_string(self):
        with pytest.raises(TypeError):
            detect_automation_controlled_triggers("--headless")

    def test_rejects_a_non_string_argument(self):
        with pytest.raises(TypeError):
            detect_automation_controlled_triggers(["--headless", 9222])


class TestDisablesAutomationControlled:
    """Recognising a switch list that already turns the feature off."""

    def test_false_for_plain_arguments(self):
        assert disables_automation_controlled(["--no-first-run"]) is False

    def test_true_for_the_exact_switch(self):
        assert disables_automation_controlled([AUTOMATION_CONTROLLED_OFF_ARG]) is True

    def test_true_when_listed_among_other_features(self):
        assert (
            disables_automation_controlled(
                [
                    "--disable-blink-features=AcceleratedSmallCanvases,AutomationControlled"
                ]
            )
            is True
        )

    def test_tolerates_spaces_around_the_feature_name(self):
        assert (
            disables_automation_controlled(
                ["--disable-blink-features=Foo, AutomationControlled"]
            )
            is True
        )

    def test_false_for_a_different_feature(self):
        assert disables_automation_controlled(["--disable-blink-features=Foo"]) is False

    def test_false_when_the_feature_is_enabled_rather_than_disabled(self):
        assert (
            disables_automation_controlled(
                ["--enable-blink-features=AutomationControlled"]
            )
            is False
        )


class TestApplyAutomationParityArgs:
    """Applying parity is idempotent and never duplicates the switch."""

    def test_appends_the_switch_to_plain_arguments(self):
        assert apply_automation_parity_args(["--no-first-run"]) == [
            "--no-first-run",
            AUTOMATION_CONTROLLED_OFF_ARG,
        ]

    def test_appends_to_an_empty_list(self):
        assert apply_automation_parity_args() == [AUTOMATION_CONTROLLED_OFF_ARG]

    def test_does_not_mutate_the_input(self):
        args = ["--no-first-run"]
        apply_automation_parity_args(args)
        assert args == ["--no-first-run"]

    def test_is_idempotent(self):
        once = apply_automation_parity_args(["--no-first-run"])
        assert apply_automation_parity_args(once) == once

    def test_extends_an_existing_blink_feature_list_in_place(self):
        # Chrome keeps only the last --disable-blink-features occurrence, so a
        # second one would silently discard the caller's features.
        assert apply_automation_parity_args(
            ["--disable-blink-features=Foo", "--no-first-run"]
        ) == [
            "--disable-blink-features=Foo,AutomationControlled",
            "--no-first-run",
        ]

    def test_extends_only_the_first_blink_feature_list(self):
        applied = apply_automation_parity_args(
            ["--disable-blink-features=Foo", "--disable-blink-features=Bar"]
        )
        assert applied == [
            "--disable-blink-features=Foo,AutomationControlled",
            "--disable-blink-features=Bar",
        ]

    def test_rejects_a_non_string_argument(self):
        with pytest.raises(TypeError):
            apply_automation_parity_args([None])


class TestParityIgnoredDefaultArgs:
    """Switches the engine adds that have to be excluded at launch."""

    def test_playwright_headful_excludes_the_automation_switch(self):
        assert parity_ignored_default_args("playwright") == [
            "--enable-automation",
            PLAYWRIGHT_SOFTWARE_WEBGL_ARG,
        ]

    def test_playwright_headless_also_excludes_the_pointer_switch(self):
        # Playwright appends the pointer switch after the caller's arguments, so
        # exclusion is the only mechanism that can remove it.
        assert parity_ignored_default_args("playwright", headless=True) == [
            "--enable-automation",
            PLAYWRIGHT_SOFTWARE_WEBGL_ARG,
            PLAYWRIGHT_HEADLESS_POINTER_ARG,
        ]

    def test_playwright_excludes_the_software_webgl_switch_in_both_modes(self):
        # Playwright 1.62 pushes --enable-unsafe-swiftshader on every platform,
        # so a machine with no usable GPU gets a SwiftShader WebGL context where
        # a hand-started Chrome gets none. Headless Chrome turns SwiftShader on
        # by itself, so the switch has to be excluded in both modes.
        for headless in (False, True):
            assert PLAYWRIGHT_SOFTWARE_WEBGL_ARG in parity_ignored_default_args(
                "playwright", headless=headless
            )

    def test_selenium_has_no_headless_pointer_switch(self):
        assert parity_ignored_default_args("selenium", headless=True) == [
            "--enable-automation"
        ]

    def test_unknown_engine_is_rejected_by_name(self):
        with pytest.raises(ValueError, match="unknown engine"):
            parity_ignored_default_args("webdriverio")

    def test_every_engine_in_the_table_is_answerable(self):
        for engine in ENGINE_PARITY_IGNORED_DEFAULT_ARGS:
            assert parity_ignored_default_args(engine, headless=True)
