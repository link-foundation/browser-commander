"""Normalization and validation of fingerprint profiles.

A fingerprint profile is the complete description of the environment a page is
allowed to see: who the browser claims to be, where it claims to run, and what
hardware it claims to have.

Every field here is applied through a documented mechanism -- a Chrome switch,
a CDP ``Emulation`` command, or a page init script -- and the mechanism is
recorded in ``FINGERPRINT_FIELD_MECHANISMS`` so callers can tell an override
the browser enforces from an override that is only a JavaScript patch. See
``docs/case-studies/issue-79`` for the surfaces that have no mechanism at all.

The profile is a plain :class:`dict` with the camelCase field names the Chrome
DevTools Protocol uses, so it can be handed to ``json.dumps`` and to a CDP
session without a second vocabulary in between. This is the Python side of
``js/src/fingerprint/profile.js``; the unit tests are translations of each
other. Wrong types raise :class:`TypeError` and impossible values raise
:class:`ValueError`, following the convention of the rest of this package.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from types import MappingProxyType
from typing import Any

from .derive import derive_user_agent_data

_BRAND_KEYS = ("brand", "version")

KNOWN_FINGERPRINT_PROFILE_FIELDS = frozenset(
    {
        "userAgent",
        "userAgentData",
        "acceptLanguage",
        "languages",
        "locale",
        "timezoneId",
        "platform",
        "vendor",
        "hardwareConcurrency",
        "deviceMemory",
        "maxTouchPoints",
        "doNotTrack",
        "screen",
        "viewport",
        "webgl",
        "geolocation",
        "colorScheme",
        "reducedMotion",
        "forcedColors",
    }
)

COLOR_SCHEMES = ("light", "dark", "no-preference")
REDUCED_MOTIONS = ("reduce", "no-preference")
FORCED_COLORS = ("active", "none")


def _optional_string(value: Any, name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError(f"{name} must be a string")
    return value


def _optional_boolean(value: Any, name: str) -> bool | None:
    if value is None:
        return None
    if not isinstance(value, bool):
        raise TypeError(f"{name} must be a boolean")
    return value


def _is_integer(value: Any) -> bool:
    # bool is a subclass of int, and True is not a core count.
    return isinstance(value, int) and not isinstance(value, bool)


def _optional_positive_integer(value: Any, name: str) -> int | None:
    if value is None:
        return None
    if not _is_integer(value) or value <= 0:
        raise TypeError(f"{name} must be a positive integer")
    return value


def _optional_non_negative_integer(value: Any, name: str) -> int | None:
    if value is None:
        return None
    if not _is_integer(value) or value < 0:
        raise TypeError(f"{name} must be a non-negative integer")
    return value


def _optional_positive_number(value: Any, name: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be a positive number")
    if not math.isfinite(value) or value <= 0:
        raise TypeError(f"{name} must be a positive number")
    return value


def _optional_string_list(value: Any, name: str) -> list[str] | None:
    if value is None:
        return None
    if isinstance(value, str) or not isinstance(value, Sequence):
        raise TypeError(f"{name} must be a list of strings")
    items = list(value)
    if any(not isinstance(item, str) for item in items):
        raise TypeError(f"{name} must be a list of strings")
    if not items:
        raise ValueError(f"{name} must not be empty")
    return items


def _optional_brands(value: Any, name: str) -> list[dict[str, str]] | None:
    if value is None:
        return None
    if isinstance(value, (str, Mapping)) or not isinstance(value, Sequence):
        raise TypeError(f"{name} must be a list of {{brand, version}} entries")
    brands = []
    for index, entry in enumerate(value):
        if not isinstance(entry, Mapping):
            raise TypeError(f"{name}[{index}] must be a mapping")
        for key in _BRAND_KEYS:
            if not isinstance(entry.get(key), str):
                raise TypeError(f"{name}[{index}].{key} must be a string")
        brands.append({"brand": entry["brand"], "version": entry["version"]})
    return brands


def _optional_enum(value: Any, name: str, allowed: Iterable[str]) -> str | None:
    if value is None:
        return None
    allowed = tuple(allowed)
    if value not in allowed:
        raise ValueError(f"{name} must be one of {', '.join(allowed)}")
    return value


def _compact(fields: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in fields.items() if value is not None}


def _section(value: Any, name: str) -> Mapping[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise TypeError(f"{name} must be a mapping")
    return value


def _resolve_screen(screen: Any) -> dict[str, Any] | None:
    section = _section(screen, "screen")
    if section is None:
        return None
    resolved = _compact(
        {
            "width": _optional_positive_integer(section.get("width"), "screen.width"),
            "height": _optional_positive_integer(
                section.get("height"), "screen.height"
            ),
            "availWidth": _optional_positive_integer(
                section.get("availWidth"), "screen.availWidth"
            ),
            "availHeight": _optional_positive_integer(
                section.get("availHeight"), "screen.availHeight"
            ),
            "colorDepth": _optional_positive_integer(
                section.get("colorDepth"), "screen.colorDepth"
            ),
            "pixelDepth": _optional_positive_integer(
                section.get("pixelDepth"), "screen.pixelDepth"
            ),
        }
    )
    if ("width" in resolved) != ("height" in resolved):
        raise ValueError("screen.width and screen.height must be provided together")
    return resolved or None


def _resolve_viewport(viewport: Any) -> dict[str, Any] | None:
    section = _section(viewport, "viewport")
    if section is None:
        return None
    resolved = _compact(
        {
            "width": _optional_positive_integer(section.get("width"), "viewport.width"),
            "height": _optional_positive_integer(
                section.get("height"), "viewport.height"
            ),
            "deviceScaleFactor": _optional_positive_number(
                section.get("deviceScaleFactor"), "viewport.deviceScaleFactor"
            ),
            "mobile": _optional_boolean(section.get("mobile"), "viewport.mobile"),
        }
    )
    if ("width" in resolved) != ("height" in resolved):
        raise ValueError("viewport.width and viewport.height must be provided together")
    return resolved or None


def _coordinate(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be a finite number")
    if not math.isfinite(value):
        raise TypeError(f"{name} must be a finite number")
    return value


def _resolve_geolocation(geolocation: Any) -> dict[str, Any] | None:
    section = _section(geolocation, "geolocation")
    if section is None:
        return None
    latitude = _coordinate(section.get("latitude"), "geolocation.latitude")
    longitude = _coordinate(section.get("longitude"), "geolocation.longitude")
    if latitude < -90 or latitude > 90:
        raise ValueError("geolocation.latitude must be between -90 and 90")
    if longitude < -180 or longitude > 180:
        raise ValueError("geolocation.longitude must be between -180 and 180")
    return _compact(
        {
            "latitude": latitude,
            "longitude": longitude,
            "accuracy": _optional_positive_number(
                section.get("accuracy"), "geolocation.accuracy"
            ),
        }
    )


def _resolve_webgl(webgl: Any) -> dict[str, Any] | None:
    section = _section(webgl, "webgl")
    if section is None:
        return None
    resolved = _compact(
        {
            "vendor": _optional_string(section.get("vendor"), "webgl.vendor"),
            "renderer": _optional_string(section.get("renderer"), "webgl.renderer"),
            "unmaskedVendor": _optional_string(
                section.get("unmaskedVendor"), "webgl.unmaskedVendor"
            ),
            "unmaskedRenderer": _optional_string(
                section.get("unmaskedRenderer"), "webgl.unmaskedRenderer"
            ),
        }
    )
    return resolved or None


def _resolve_accept_language(accept_language: str | None) -> str | None:
    """Reject the q-value form Chrome misparses.

    Chrome derives both the Accept-Language header and ``navigator.languages``
    from this one string, and it splits on commas without stripping q-values.
    Passing ``de-DE,de;q=0.9`` therefore yields the language tag ``"de;q=0.9"``
    and the header ``de-DE,de;q=0.9;q=0.9``; passing the plain list
    ``de-DE,de,en`` yields correct tags and the header
    ``de-DE,de;q=0.9,en;q=0.8`` that a real browser sends. Measured in
    ``docs/case-studies/issue-79/analysis-artifacts/ua-hints-detail.json``.
    """
    if accept_language is None:
        return None
    if ";" in accept_language:
        raise ValueError(
            "acceptLanguage must be a plain comma-separated language list without "
            "q-values; Chrome generates the quality values itself"
        )
    return accept_language


def _with_full_version(
    user_agent_data: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Keep ``uaFullVersion`` consistent with ``fullVersionList``."""
    if not user_agent_data or "fullVersion" in user_agent_data:
        return user_agent_data
    primary = next(
        (
            entry
            for entry in user_agent_data.get("fullVersionList", [])
            if entry["brand"] in ("Google Chrome", "Chromium")
        ),
        None,
    )
    if primary is None:
        return user_agent_data
    return {**user_agent_data, "fullVersion": primary["version"]}


def _resolve_user_agent_data(user_agent_data: Any) -> dict[str, Any] | None:
    section = _section(user_agent_data, "userAgentData")
    if section is None:
        return None
    resolved = _compact(
        {
            "brands": _optional_brands(section.get("brands"), "userAgentData.brands"),
            "fullVersionList": _optional_brands(
                section.get("fullVersionList"), "userAgentData.fullVersionList"
            ),
            "platform": _optional_string(
                section.get("platform"), "userAgentData.platform"
            ),
            "platformVersion": _optional_string(
                section.get("platformVersion"), "userAgentData.platformVersion"
            ),
            "architecture": _optional_string(
                section.get("architecture"), "userAgentData.architecture"
            ),
            "bitness": _optional_string(
                section.get("bitness"), "userAgentData.bitness"
            ),
            # Deprecated in the protocol but still the only way to control the
            # `uaFullVersion` high-entropy hint: with `fullVersionList` alone
            # the page still reads the real Chrome build number.
            "fullVersion": _optional_string(
                section.get("fullVersion"), "userAgentData.fullVersion"
            ),
            "model": _optional_string(section.get("model"), "userAgentData.model"),
            "mobile": _optional_boolean(section.get("mobile"), "userAgentData.mobile"),
            "wow64": _optional_boolean(section.get("wow64"), "userAgentData.wow64"),
            "formFactors": _optional_string_list(
                section.get("formFactors"), "userAgentData.formFactors"
            ),
        }
    )
    return resolved or None


def resolve_fingerprint_profile(
    profile: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Normalize and validate a fingerprint profile.

    Unknown keys are rejected rather than ignored: a typo in
    ``hardwareConcurency`` would otherwise silently leave the real core count
    exposed, which is exactly the failure this module exists to prevent.

    Every list is copied, so a later mutation of the input cannot reach the
    returned profile.

    Args:
        profile: Raw profile, or ``None`` for an empty one.

    Returns:
        A new normalized profile containing only the fields that were supplied.

    Raises:
        TypeError: If a field has the wrong type.
        ValueError: If a field is unknown, empty, or out of range.
    """
    if profile is None:
        profile = {}
    if not isinstance(profile, Mapping):
        raise TypeError("fingerprint profile must be a mapping")

    for key in profile:
        if key not in KNOWN_FINGERPRINT_PROFILE_FIELDS:
            known = ", ".join(sorted(KNOWN_FINGERPRINT_PROFILE_FIELDS))
            raise ValueError(
                f'unknown fingerprint profile field "{key}"; known fields: {known}'
            )

    languages = _optional_string_list(profile.get("languages"), "languages")
    accept_language = _optional_string(profile.get("acceptLanguage"), "acceptLanguage")
    if accept_language is None and languages is not None:
        accept_language = ",".join(languages)
    accept_language = _resolve_accept_language(accept_language)
    user_agent = _optional_string(profile.get("userAgent"), "userAgent")
    user_agent_data = _resolve_user_agent_data(profile.get("userAgentData"))
    if user_agent_data is None and user_agent is not None:
        user_agent_data = derive_user_agent_data(user_agent)

    return _compact(
        {
            "userAgent": user_agent,
            "userAgentData": _with_full_version(user_agent_data),
            "acceptLanguage": accept_language,
            "languages": languages,
            "locale": _optional_string(profile.get("locale"), "locale"),
            "timezoneId": _optional_string(profile.get("timezoneId"), "timezoneId"),
            "platform": _optional_string(profile.get("platform"), "platform"),
            "vendor": _optional_string(profile.get("vendor"), "vendor"),
            "hardwareConcurrency": _optional_positive_integer(
                profile.get("hardwareConcurrency"), "hardwareConcurrency"
            ),
            "deviceMemory": _optional_positive_number(
                profile.get("deviceMemory"), "deviceMemory"
            ),
            "maxTouchPoints": _optional_non_negative_integer(
                profile.get("maxTouchPoints"), "maxTouchPoints"
            ),
            "doNotTrack": _optional_string(profile.get("doNotTrack"), "doNotTrack"),
            "screen": _resolve_screen(profile.get("screen")),
            "viewport": _resolve_viewport(profile.get("viewport")),
            "webgl": _resolve_webgl(profile.get("webgl")),
            "geolocation": _resolve_geolocation(profile.get("geolocation")),
            "colorScheme": _optional_enum(
                profile.get("colorScheme"), "colorScheme", COLOR_SCHEMES
            ),
            "reducedMotion": _optional_enum(
                profile.get("reducedMotion"), "reducedMotion", REDUCED_MOTIONS
            ),
            "forcedColors": _optional_enum(
                profile.get("forcedColors"), "forcedColors", FORCED_COLORS
            ),
        }
    )


FINGERPRINT_FIELD_MECHANISMS = MappingProxyType(
    {
        "userAgent": "browser",
        "userAgentData": "browser",
        "acceptLanguage": "browser",
        "languages": "browser",
        "locale": "browser",
        "timezoneId": "browser",
        "hardwareConcurrency": "browser",
        "screen": "browser",
        "viewport": "browser",
        "maxTouchPoints": "browser",
        "geolocation": "browser",
        "colorScheme": "browser",
        "reducedMotion": "browser",
        "forcedColors": "browser",
        "platform": "browser",
        "vendor": "script",
        "deviceMemory": "script",
        "doNotTrack": "script",
        "webgl": "script",
    }
)
"""How each profile field reaches the page.

``browser`` means Chrome itself produces the value, so it holds for the
document, for HTTP headers and for any code that reads it, and a page cannot
detect the override by comparing two ways of asking. ``script`` means the value
is a JavaScript property patch installed before page scripts run, which is
weaker: it holds for the main world but is not what the network stack or a
fresh renderer would say.

Neither kind reaches a worker in full. Measured in a dedicated worker,
``userAgent``, ``timezoneId`` and ``locale`` follow the profile while
``platform``, ``languages`` and ``hardwareConcurrency`` revert to the host
values; see ``docs/case-studies/issue-79/analysis-artifacts/worker-visibility.json``.
"""
