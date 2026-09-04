"""Fingerprint parity between a real Chrome and a controlled one."""

from browser_commander.fingerprint.apply import (
    AppliedFingerprint,
    SeleniumCdpSession,
    apply_fingerprint,
    create_cdp_session,
)
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
from browser_commander.fingerprint.cdp_overrides import (
    CdpCommand,
    build_cdp_emulation_commands,
)
from browser_commander.fingerprint.derive import derive_user_agent_data
from browser_commander.fingerprint.init_script import (
    FINGERPRINT_PAYLOAD_SOURCE,
    build_fingerprint_init_script,
    build_init_script_config,
)
from browser_commander.fingerprint.presets import (
    DEFAULT_CHROME_VERSION,
    FINGERPRINT_PRESET_NAMES,
    create_fingerprint_preset,
)
from browser_commander.fingerprint.profile import (
    FINGERPRINT_FIELD_MECHANISMS,
    KNOWN_FINGERPRINT_PROFILE_FIELDS,
    resolve_fingerprint_profile,
)

__all__ = [
    "AUTOMATION_CONTROLLED_OFF_ARG",
    "AUTOMATION_CONTROLLED_TRIGGERS",
    "DEFAULT_CHROME_VERSION",
    "ENGINE_PARITY_IGNORED_DEFAULT_ARGS",
    "FINGERPRINT_FIELD_MECHANISMS",
    "FINGERPRINT_PAYLOAD_SOURCE",
    "FINGERPRINT_PRESET_NAMES",
    "KNOWN_FINGERPRINT_PROFILE_FIELDS",
    "PLAYWRIGHT_HEADLESS_POINTER_ARG",
    "AppliedFingerprint",
    "AutomationTrigger",
    "CdpCommand",
    "DetectedTrigger",
    "SeleniumCdpSession",
    "apply_automation_parity_args",
    "apply_fingerprint",
    "build_cdp_emulation_commands",
    "build_fingerprint_init_script",
    "build_init_script_config",
    "create_cdp_session",
    "create_fingerprint_preset",
    "derive_user_agent_data",
    "detect_automation_controlled_triggers",
    "disables_automation_controlled",
    "parity_ignored_default_args",
    "resolve_fingerprint_profile",
]
