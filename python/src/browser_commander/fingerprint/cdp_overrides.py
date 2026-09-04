"""Translate a fingerprint profile into CDP ``Emulation`` commands.

These are the overrides Chrome itself enforces. They apply to workers and to
outgoing HTTP headers, not only to the main world, which is what makes them
strictly better than patching JavaScript properties. Anything that has no
command here needs a page init script instead; ``init_script.py`` carries the
weaker half and ``docs/case-studies/issue-79/requirements.md`` records why.

This is the Python side of ``js/src/fingerprint/cdp-overrides.js``; the command
list is asserted field by field in both languages so the two cannot drift.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class CdpCommand:
    """One protocol call: a method name and its parameters."""

    method: str
    params: dict[str, Any] = field(default_factory=dict)


def _user_agent_metadata(profile: Mapping[str, Any]) -> dict[str, Any] | None:
    data = profile.get("userAgentData")
    if not data:
        return None
    # platform, platformVersion, architecture, model and mobile are required by
    # the protocol; Chrome rejects the command when any of them is missing.
    metadata: dict[str, Any] = {
        "platform": data.get("platform", ""),
        "platformVersion": data.get("platformVersion", ""),
        "architecture": data.get("architecture", ""),
        "model": data.get("model", ""),
        "mobile": data.get("mobile", False),
    }
    if "brands" in data:
        metadata["brands"] = [dict(entry) for entry in data["brands"]]
    if "fullVersionList" in data:
        metadata["fullVersionList"] = [dict(entry) for entry in data["fullVersionList"]]
    if "bitness" in data:
        metadata["bitness"] = data["bitness"]
    if "fullVersion" in data:
        # Deprecated in the protocol, but ``fullVersionList`` does not cover the
        # ``uaFullVersion`` hint: without this the page still reads the real
        # Chrome build number.
        metadata["fullVersion"] = data["fullVersion"]
    if "wow64" in data:
        metadata["wow64"] = data["wow64"]
    if "formFactors" in data:
        metadata["formFactors"] = list(data["formFactors"])
    return metadata


def _emulated_media_features(profile: Mapping[str, Any]) -> list[dict[str, str]]:
    features = []
    if "reducedMotion" in profile:
        features.append(
            {"name": "prefers-reduced-motion", "value": profile["reducedMotion"]}
        )
    if "forcedColors" in profile:
        features.append({"name": "forced-colors", "value": profile["forcedColors"]})
    if "colorScheme" in profile:
        features.append(
            {"name": "prefers-color-scheme", "value": profile["colorScheme"]}
        )
    return features


def _device_metrics(profile: Mapping[str, Any]) -> dict[str, Any] | None:
    viewport = profile.get("viewport") or {}
    screen = profile.get("screen") or {}
    if not viewport and not screen:
        return None
    params: dict[str, Any] = {
        # 0 means "no override" for the viewport, so a profile that only sets
        # screen dimensions still leaves the real window size alone.
        "width": viewport.get("width", 0),
        "height": viewport.get("height", 0),
        "deviceScaleFactor": viewport.get("deviceScaleFactor", 0),
        "mobile": viewport.get("mobile", False),
    }
    if "width" in screen:
        params["screenWidth"] = screen["width"]
        params["screenHeight"] = screen["height"]
    return params


def _user_agent_command(profile: Mapping[str, Any]) -> CdpCommand | None:
    if "userAgent" not in profile and "acceptLanguage" not in profile:
        return None
    params: dict[str, Any] = {}
    if "userAgent" in profile:
        params["userAgent"] = profile["userAgent"]
    if "acceptLanguage" in profile:
        params["acceptLanguage"] = profile["acceptLanguage"]
    if "platform" in profile:
        params["platform"] = profile["platform"]
    metadata = _user_agent_metadata(profile)
    if metadata is not None:
        params["userAgentMetadata"] = metadata
    # userAgent is a required parameter even when only the language changes.
    params.setdefault("userAgent", "")
    return CdpCommand("Emulation.setUserAgentOverride", params)


def build_cdp_emulation_commands(profile: Mapping[str, Any]) -> list[CdpCommand]:
    """Build the ordered CDP command list for a normalized profile."""
    if not isinstance(profile, Mapping):
        raise TypeError("profile must be a normalized fingerprint profile")

    commands: list[CdpCommand] = []

    user_agent_command = _user_agent_command(profile)
    if user_agent_command is not None:
        commands.append(user_agent_command)

    if "timezoneId" in profile:
        commands.append(
            CdpCommand(
                "Emulation.setTimezoneOverride",
                {"timezoneId": profile["timezoneId"]},
            )
        )

    if "locale" in profile:
        commands.append(
            CdpCommand("Emulation.setLocaleOverride", {"locale": profile["locale"]})
        )

    if "hardwareConcurrency" in profile:
        commands.append(
            CdpCommand(
                "Emulation.setHardwareConcurrencyOverride",
                {"hardwareConcurrency": profile["hardwareConcurrency"]},
            )
        )

    metrics = _device_metrics(profile)
    if metrics is not None:
        commands.append(CdpCommand("Emulation.setDeviceMetricsOverride", metrics))

    if "maxTouchPoints" in profile:
        commands.append(
            CdpCommand(
                "Emulation.setTouchEmulationEnabled",
                {
                    "enabled": profile["maxTouchPoints"] > 0,
                    "maxTouchPoints": max(profile["maxTouchPoints"], 1),
                },
            )
        )

    features = _emulated_media_features(profile)
    if features:
        commands.append(
            CdpCommand("Emulation.setEmulatedMedia", {"features": features})
        )

    if "geolocation" in profile:
        commands.append(
            CdpCommand("Emulation.setGeolocationOverride", dict(profile["geolocation"]))
        )

    return commands
