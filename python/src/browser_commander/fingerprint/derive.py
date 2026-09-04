"""Derive User-Agent Client Hints from a User-Agent string.

This exists because of a measured trap: ``Emulation.setUserAgentOverride``
replaces the whole identity, so overriding ``userAgent`` *without*
``userAgentMetadata`` leaves ``navigator.userAgentData.brands`` empty and
``getHighEntropyValues(['fullVersionList'])`` returning ``[]``. A real browser
never reports that combination, so a bare UA override is a louder automation
signal than the default UA it replaced. See
``docs/case-studies/issue-79/analysis-artifacts/ua-hints-detail.json``.

Deriving is best effort. Chrome's GREASE brand -- the ``Not=A?Brand`` entry --
is generated from a per-version permutation table that this module does not
reproduce; ``limitations`` records that.

This is the Python side of ``js/src/fingerprint/derive.js``, kept in step with
it and with ``rust/src/fingerprint/derive.rs``: the unit tests are translations
of each other, so a divergence fails a test instead of surfacing later as a
fingerprint difference.
"""

from __future__ import annotations

import re
from typing import Any

CHROME_VERSION = re.compile(r"Chrome/(\d+)(?:\.(\d+)\.(\d+)\.(\d+))?")

GREASE_BRAND = "Not=A?Brand"
GREASE_VERSION = "24"

_ANDROID_MODEL = re.compile(r"; ([^;)]+) Build/")
_ANDROID_VERSION = re.compile(r"Android (\d+(?:\.\d+)*)")
_MACOS_VERSION = re.compile(r"Mac OS X (\d+)[._](\d+)(?:[._](\d+))?")


def _platform_from_user_agent(user_agent: str) -> tuple[str, str, str]:
    """Return ``(platform, architecture, bitness)`` for a User-Agent string."""
    if "Windows NT" in user_agent:
        return ("Windows", "x86", "64")
    if "Android" in user_agent:
        return ("Android", "", "")
    if "Macintosh" in user_agent or "Mac OS X" in user_agent:
        return ("macOS", "arm", "64")
    if "CrOS" in user_agent:
        return ("Chrome OS", "x86", "64")
    if "X11" in user_agent or "Linux" in user_agent:
        return ("Linux", "x86", "64")
    return ("", "", "")


def _platform_version_from_user_agent(user_agent: str, platform: str) -> str:
    if platform == "Windows":
        # Chrome freezes the UA string at "Windows NT 10.0" and moves the real
        # version into the platformVersion hint: 13+ means Windows 11.
        return "15.0.0" if "Windows NT 10.0" in user_agent else "0.0.0"
    if platform == "macOS":
        match = _MACOS_VERSION.search(user_agent)
        return f"{match[1]}.{match[2]}.{match[3] or '0'}" if match else ""
    if platform == "Android":
        match = _ANDROID_VERSION.search(user_agent)
        return match[1] if match else ""
    return ""


def derive_user_agent_data(user_agent: str) -> dict[str, Any] | None:
    """Build a complete ``userAgentData`` block for a Chrome User-Agent string.

    Args:
        user_agent: A Chrome or Chromium User-Agent string.

    Returns:
        Client hints, or ``None`` when the string names no Chrome version and
        there is nothing trustworthy to derive.

    Raises:
        TypeError: If ``user_agent`` is not a string.
    """
    if not isinstance(user_agent, str):
        raise TypeError("userAgent must be a string")
    version = CHROME_VERSION.search(user_agent)
    if not version:
        return None
    major = version[1]
    full = version[0][len("Chrome/") :] if version[2] else f"{major}.0.0.0"
    platform, architecture, bitness = _platform_from_user_agent(user_agent)
    mobile = "Mobile" in user_agent
    model = ""
    if mobile:
        match = _ANDROID_MODEL.search(user_agent)
        model = match[1] if match else ""

    return {
        "brands": [
            {"brand": "Chromium", "version": major},
            {"brand": "Google Chrome", "version": major},
            {"brand": GREASE_BRAND, "version": GREASE_VERSION},
        ],
        "fullVersionList": [
            {"brand": "Chromium", "version": full},
            {"brand": "Google Chrome", "version": full},
            {"brand": GREASE_BRAND, "version": f"{GREASE_VERSION}.0.0.0"},
        ],
        "fullVersion": full,
        "platform": platform,
        "platformVersion": _platform_version_from_user_agent(user_agent, platform),
        "architecture": architecture,
        "bitness": bitness,
        "model": model,
        "mobile": mobile,
        "wow64": False,
        "formFactors": ["Mobile" if mobile else "Desktop"],
    }
