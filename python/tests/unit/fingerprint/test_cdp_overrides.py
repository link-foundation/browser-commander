"""Tests for the CDP ``Emulation`` command list.

These mirror ``js/tests/unit/fingerprint/cdp-overrides.test.js`` one for one, so
a difference between the two implementations fails a test instead of surfacing
as a fingerprint difference months later.
"""

from __future__ import annotations

from typing import Any

import pytest

from browser_commander.fingerprint.cdp_overrides import (
    CdpCommand,
    build_cdp_emulation_commands,
)
from browser_commander.fingerprint.presets import create_fingerprint_preset
from browser_commander.fingerprint.profile import resolve_fingerprint_profile

WINDOWS_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.7000.55 Safari/537.36"
)


def commands(profile: dict[str, Any]) -> list[CdpCommand]:
    return build_cdp_emulation_commands(resolve_fingerprint_profile(profile))


def methods(profile: dict[str, Any]) -> list[str]:
    return [command.method for command in commands(profile)]


def params(profile: dict[str, Any], method: str) -> dict[str, Any]:
    for command in commands(profile):
        if command.method == method:
            return command.params
    raise AssertionError(f"{method} was not sent")


def test_rejects_anything_that_is_not_a_profile_mapping() -> None:
    for value in (None, "windows", 42):
        with pytest.raises(TypeError, match="must be a normalized fingerprint profile"):
            build_cdp_emulation_commands(value)  # type: ignore[arg-type]


def test_emits_nothing_for_an_empty_profile() -> None:
    assert commands({}) == []


def test_sends_only_the_commands_the_profile_asks_for() -> None:
    assert methods({"timezoneId": "Europe/Berlin"}) == ["Emulation.setTimezoneOverride"]
    assert methods({"hardwareConcurrency": 4}) == [
        "Emulation.setHardwareConcurrencyOverride"
    ]


def test_keeps_a_stable_command_order_for_a_full_profile() -> None:
    assert methods(
        {
            "userAgent": WINDOWS_USER_AGENT,
            "timezoneId": "Europe/Berlin",
            "locale": "de-DE",
            "hardwareConcurrency": 12,
            "screen": {"width": 2560, "height": 1440},
            "viewport": {"width": 1280, "height": 720},
            "maxTouchPoints": 0,
            "colorScheme": "dark",
            "geolocation": {"latitude": 52.52, "longitude": 13.405, "accuracy": 20},
        }
    ) == [
        "Emulation.setUserAgentOverride",
        "Emulation.setTimezoneOverride",
        "Emulation.setLocaleOverride",
        "Emulation.setHardwareConcurrencyOverride",
        "Emulation.setDeviceMetricsOverride",
        "Emulation.setTouchEmulationEnabled",
        "Emulation.setEmulatedMedia",
        "Emulation.setGeolocationOverride",
    ]


def test_supplies_the_required_empty_user_agent_when_only_the_language_changes() -> (
    None
):
    sent = params({"languages": ["fr-FR", "fr"]}, "Emulation.setUserAgentOverride")

    # userAgent is a required protocol parameter; an empty string means
    # "leave it alone" while acceptLanguage still takes effect.
    assert sent["userAgent"] == ""
    assert sent["acceptLanguage"] == "fr-FR,fr"


def test_carries_the_client_hints_including_the_deprecated_full_version() -> None:
    sent = params(
        {"userAgent": WINDOWS_USER_AGENT, "platform": "Win32"},
        "Emulation.setUserAgentOverride",
    )
    metadata = sent["userAgentMetadata"]

    assert sent["platform"] == "Win32"
    assert metadata["platform"] == "Windows"
    # fullVersionList does not cover the uaFullVersion hint, so the deprecated
    # fullVersion field has to travel with it.
    assert metadata["fullVersion"] == "140.0.7000.55"
    assert metadata["bitness"] == "64"
    assert metadata["wow64"] is False
    assert metadata["formFactors"] == ["Desktop"]


def test_always_fills_the_protocol_required_metadata_fields() -> None:
    metadata = params(
        {
            "userAgent": "custom agent",
            "userAgentData": {"brands": [{"brand": "Custom", "version": "1"}]},
        },
        "Emulation.setUserAgentOverride",
    )["userAgentMetadata"]

    # Chrome rejects setUserAgentOverride when any of these is missing.
    for field in ("platform", "platformVersion", "architecture", "model", "mobile"):
        assert field in metadata, f"{field} must be present"
    assert metadata["mobile"] is False
    assert "bitness" not in metadata


def test_copies_the_brand_entries_instead_of_sharing_them_with_the_profile() -> None:
    profile = resolve_fingerprint_profile({"userAgent": WINDOWS_USER_AGENT})
    metadata = build_cdp_emulation_commands(profile)[0].params["userAgentMetadata"]

    assert metadata["brands"] == profile["userAgentData"]["brands"]
    assert metadata["brands"] is not profile["userAgentData"]["brands"]
    assert metadata["brands"][0] is not profile["userAgentData"]["brands"][0]


def test_leaves_the_window_size_alone_when_only_the_screen_is_described() -> None:
    # Zeroes mean "no override" for the viewport, so a screen-only profile does
    # not resize the window it was applied to.
    assert params(
        {"screen": {"width": 2560, "height": 1440}},
        "Emulation.setDeviceMetricsOverride",
    ) == {
        "width": 0,
        "height": 0,
        "deviceScaleFactor": 0,
        "mobile": False,
        "screenWidth": 2560,
        "screenHeight": 1440,
    }


def test_sends_the_viewport_without_screen_dimensions_when_no_screen_is_set() -> None:
    assert params(
        {
            "viewport": {
                "width": 1280,
                "height": 720,
                "deviceScaleFactor": 2,
                "mobile": True,
            }
        },
        "Emulation.setDeviceMetricsOverride",
    ) == {"width": 1280, "height": 720, "deviceScaleFactor": 2, "mobile": True}


def test_disables_touch_emulation_for_a_profile_that_names_zero_touch_points() -> None:
    # maxTouchPoints must stay at least 1 because the protocol rejects 0, so
    # "no touch" is expressed through enabled instead.
    assert params({"maxTouchPoints": 0}, "Emulation.setTouchEmulationEnabled") == {
        "enabled": False,
        "maxTouchPoints": 1,
    }
    assert params({"maxTouchPoints": 5}, "Emulation.setTouchEmulationEnabled") == {
        "enabled": True,
        "maxTouchPoints": 5,
    }


def test_collects_every_media_preference_into_a_single_command() -> None:
    assert params(
        {"colorScheme": "dark", "reducedMotion": "reduce", "forcedColors": "active"},
        "Emulation.setEmulatedMedia",
    ) == {
        "features": [
            {"name": "prefers-reduced-motion", "value": "reduce"},
            {"name": "forced-colors", "value": "active"},
            {"name": "prefers-color-scheme", "value": "dark"},
        ]
    }


def test_passes_geolocation_through_as_its_own_copy() -> None:
    geolocation = {"latitude": 48.85, "longitude": 2.35, "accuracy": 10}
    sent = params({"geolocation": geolocation}, "Emulation.setGeolocationOverride")

    assert sent == geolocation
    assert sent is not geolocation


def test_sends_every_browser_enforced_field_of_a_preset() -> None:
    # A preset is the shape most callers send, so the whole command list for one
    # is worth pinning: a field that silently stops being emulated is exactly
    # the regression this module exists to prevent.
    profile = create_fingerprint_preset("android-chrome")
    sent = build_cdp_emulation_commands(profile)

    assert [command.method for command in sent] == [
        "Emulation.setUserAgentOverride",
        "Emulation.setTimezoneOverride",
        "Emulation.setLocaleOverride",
        "Emulation.setHardwareConcurrencyOverride",
        "Emulation.setDeviceMetricsOverride",
        "Emulation.setTouchEmulationEnabled",
    ]
    assert sent[0].params["userAgentMetadata"]["mobile"] is True
