"""Fingerprint parity between a real Chrome and a controlled one."""

from browser_commander.fingerprint.automation_parity import (
    AUTOMATION_CONTROLLED_OFF_ARG,
    AUTOMATION_CONTROLLED_TRIGGERS,
    ENGINE_PARITY_IGNORED_DEFAULT_ARGS,
    PLAYWRIGHT_HEADLESS_POINTER_ARG,
    AutomationTrigger,
    DetectedTrigger,
    apply_automation_parity_args,
    detect_automation_controlled_triggers,
    disables_automation_controlled,
    parity_ignored_default_args,
)

__all__ = [
    "AUTOMATION_CONTROLLED_OFF_ARG",
    "AUTOMATION_CONTROLLED_TRIGGERS",
    "ENGINE_PARITY_IGNORED_DEFAULT_ARGS",
    "PLAYWRIGHT_HEADLESS_POINTER_ARG",
    "AutomationTrigger",
    "DetectedTrigger",
    "apply_automation_parity_args",
    "detect_automation_controlled_triggers",
    "disables_automation_controlled",
    "parity_ignored_default_args",
]
