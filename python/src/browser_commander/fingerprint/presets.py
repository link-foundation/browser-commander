"""Ready-made fingerprint profiles for the platforms Chrome ships on.

A profile is only useful if it is internally consistent: the user agent string,
the User-Agent Client Hints, ``navigator.platform``, the WebGL renderer and the
screen size all have to describe the same machine, because every serious
fingerprinting script cross-checks them. Each preset below is therefore written
as one machine rather than as a bag of independent fields.

The Chrome version is a parameter instead of a constant. A profile claiming
Chrome 131 while the binary is Chrome 149 is trivially detectable from feature
sniffing, so the caller should pass the version of the browser they actually
launch.

This is the Python side of ``js/src/fingerprint/presets.js``; the presets are
the same machines in all three languages, so a profile built here and a profile
built there produce the same page.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from typing import Any

from .profile import resolve_fingerprint_profile

DEFAULT_CHROME_VERSION = "140.0.0.0"

_DOTTED_VERSION = re.compile(r"^\d+(\.\d+)*$")


def _major_version(version: str) -> str:
    return version.split(".")[0]


def _brands_for(version: str) -> list[dict[str, str]]:
    major = _major_version(version)
    return [
        {"brand": "Google Chrome", "version": major},
        {"brand": "Chromium", "version": major},
        {"brand": "Not)A;Brand", "version": "24"},
    ]


def _full_version_list_for(version: str) -> list[dict[str, str]]:
    return [
        {"brand": "Google Chrome", "version": version},
        {"brand": "Chromium", "version": version},
        {"brand": "Not)A;Brand", "version": "24.0.0.0"},
    ]


def _desktop_user_agent(platform_token: str, version: str) -> str:
    return (
        f"Mozilla/5.0 ({platform_token}) AppleWebKit/537.36 (KHTML, like Gecko) "
        f"Chrome/{_major_version(version)}.0.0.0 Safari/537.36"
    )


def _windows_chrome(version: str) -> dict[str, Any]:
    return {
        "userAgent": _desktop_user_agent("Windows NT 10.0; Win64; x64", version),
        "userAgentData": {
            "brands": _brands_for(version),
            "fullVersionList": _full_version_list_for(version),
            "platform": "Windows",
            "platformVersion": "15.0.0",
            "architecture": "x86",
            "bitness": "64",
            "model": "",
            "mobile": False,
            "wow64": False,
            "formFactors": ["Desktop"],
        },
        "platform": "Win32",
        "vendor": "Google Inc.",
        "languages": ["en-US", "en"],
        "locale": "en-US",
        "timezoneId": "America/New_York",
        "hardwareConcurrency": 8,
        "deviceMemory": 8,
        "maxTouchPoints": 0,
        "screen": {
            "width": 1920,
            "height": 1080,
            "availWidth": 1920,
            "availHeight": 1032,
            "colorDepth": 24,
            "pixelDepth": 24,
        },
        "viewport": {
            "width": 1920,
            "height": 947,
            "deviceScaleFactor": 1,
            "mobile": False,
        },
        "webgl": {
            "vendor": "WebKit",
            "renderer": "WebKit WebGL",
            "unmaskedVendor": "Google Inc. (NVIDIA)",
            "unmaskedRenderer": (
                "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) "
                "Direct3D11 vs_5_0 ps_5_0, D3D11)"
            ),
        },
    }


def _macos_chrome(version: str) -> dict[str, Any]:
    return {
        "userAgent": _desktop_user_agent("Macintosh; Intel Mac OS X 10_15_7", version),
        "userAgentData": {
            "brands": _brands_for(version),
            "fullVersionList": _full_version_list_for(version),
            "platform": "macOS",
            "platformVersion": "15.6.0",
            "architecture": "arm",
            "bitness": "64",
            "model": "",
            "mobile": False,
            "wow64": False,
            "formFactors": ["Desktop"],
        },
        "platform": "MacIntel",
        "vendor": "Google Inc.",
        "languages": ["en-US", "en"],
        "locale": "en-US",
        "timezoneId": "America/Los_Angeles",
        "hardwareConcurrency": 10,
        "deviceMemory": 8,
        "maxTouchPoints": 0,
        "screen": {
            "width": 1728,
            "height": 1117,
            "availWidth": 1728,
            "availHeight": 1085,
            "colorDepth": 30,
            "pixelDepth": 30,
        },
        "viewport": {
            "width": 1728,
            "height": 1005,
            "deviceScaleFactor": 2,
            "mobile": False,
        },
        "webgl": {
            "vendor": "WebKit",
            "renderer": "WebKit WebGL",
            "unmaskedVendor": "Google Inc. (Apple)",
            "unmaskedRenderer": (
                "ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)"
            ),
        },
    }


def _linux_chrome(version: str) -> dict[str, Any]:
    return {
        "userAgent": _desktop_user_agent("X11; Linux x86_64", version),
        "userAgentData": {
            "brands": _brands_for(version),
            "fullVersionList": _full_version_list_for(version),
            "platform": "Linux",
            "platformVersion": "",
            "architecture": "x86",
            "bitness": "64",
            "model": "",
            "mobile": False,
            "wow64": False,
            "formFactors": ["Desktop"],
        },
        "platform": "Linux x86_64",
        "vendor": "Google Inc.",
        "languages": ["en-US", "en"],
        "locale": "en-US",
        "timezoneId": "UTC",
        "hardwareConcurrency": 8,
        "deviceMemory": 8,
        "maxTouchPoints": 0,
        "screen": {
            "width": 1920,
            "height": 1080,
            "availWidth": 1920,
            "availHeight": 1053,
            "colorDepth": 24,
            "pixelDepth": 24,
        },
        "viewport": {
            "width": 1920,
            "height": 955,
            "deviceScaleFactor": 1,
            "mobile": False,
        },
        "webgl": {
            "vendor": "WebKit",
            "renderer": "WebKit WebGL",
            "unmaskedVendor": "Google Inc. (Intel)",
            "unmaskedRenderer": (
                "ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)"
            ),
        },
    }


def _android_chrome(version: str) -> dict[str, Any]:
    return {
        "userAgent": (
            "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 "
            f"(KHTML, like Gecko) Chrome/{_major_version(version)}.0.0.0 "
            "Mobile Safari/537.36"
        ),
        "userAgentData": {
            "brands": _brands_for(version),
            "fullVersionList": _full_version_list_for(version),
            "platform": "Android",
            "platformVersion": "15.0.0",
            "architecture": "",
            "bitness": "",
            "model": "Pixel 8",
            "mobile": True,
            "wow64": False,
            "formFactors": ["Mobile"],
        },
        "platform": "Linux armv81",
        "vendor": "Google Inc.",
        "languages": ["en-US", "en"],
        "locale": "en-US",
        "timezoneId": "America/New_York",
        "hardwareConcurrency": 8,
        "deviceMemory": 8,
        "maxTouchPoints": 5,
        "screen": {
            "width": 412,
            "height": 915,
            "availWidth": 412,
            "availHeight": 915,
            "colorDepth": 24,
            "pixelDepth": 24,
        },
        "viewport": {
            "width": 412,
            "height": 823,
            "deviceScaleFactor": 2.625,
            "mobile": True,
        },
        "webgl": {
            "vendor": "WebKit",
            "renderer": "WebKit WebGL",
            "unmaskedVendor": "Google Inc. (Qualcomm)",
            "unmaskedRenderer": "ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)",
        },
    }


_BUILDERS: dict[str, Callable[[str], dict[str, Any]]] = {
    "android-chrome": _android_chrome,
    "linux-chrome": _linux_chrome,
    "macos-chrome": _macos_chrome,
    "windows-chrome": _windows_chrome,
}

FINGERPRINT_PRESET_NAMES = tuple(sorted(_BUILDERS))
"""Names accepted by :func:`create_fingerprint_preset`."""


def create_fingerprint_preset(
    name: str,
    *,
    chrome_version: str = DEFAULT_CHROME_VERSION,
    overrides: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a complete, internally consistent fingerprint profile.

    Args:
        name: One of :data:`FINGERPRINT_PRESET_NAMES`.
        chrome_version: Full Chrome version, for example ``'140.0.7339.80'``.
        overrides: Profile fields merged over the preset.

    Returns:
        A normalized fingerprint profile.

    Raises:
        TypeError: If ``chrome_version`` is not a string.
        ValueError: If the preset is unknown or the version is not dotted digits.
    """
    builder = _BUILDERS.get(name)
    if builder is None:
        known = ", ".join(FINGERPRINT_PRESET_NAMES)
        raise ValueError(f'unknown fingerprint preset "{name}"; known presets: {known}')
    if not isinstance(chrome_version, str):
        raise TypeError("chromeVersion must be a dotted numeric version string")
    if not _DOTTED_VERSION.match(chrome_version):
        raise ValueError("chromeVersion must be a dotted numeric version string")
    return resolve_fingerprint_profile({**builder(chrome_version), **(overrides or {})})
