"""Page init script for the fingerprint surfaces CDP cannot override.

Everything here is strictly worse than a browser-enforced override: a
JavaScript patch is visible to anyone who inspects the property descriptor
carefully enough, and it does not reach workers or HTTP headers. It exists only
for fields the ``Emulation`` domain has no command for, and for connecting to a
browser somebody else launched, where the switches can no longer be changed.

The payload itself is not written here. ``init_payload.js`` next to this module
is a byte-for-byte copy of ``js/src/fingerprint/init-payload.js``, kept in step
by ``scripts/check-shared-fingerprint-assets.sh``, so all three implementations send
Chrome the same script rather than three hand-written translations of it.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

_PAYLOAD_PATH = Path(__file__).parent / "init_payload.js"

#: The shared payload source, read once at import time.
FINGERPRINT_PAYLOAD_SOURCE = _PAYLOAD_PATH.read_text(encoding="utf-8")

_SCREEN_FIELDS = (
    "width",
    "height",
    "availWidth",
    "availHeight",
    "colorDepth",
    "pixelDepth",
)


def build_init_script_config(
    profile: Mapping[str, Any],
    *,
    patch_webdriver: bool = False,
    patch_languages: bool = False,
) -> dict[str, Any] | None:
    """Decide what the init script still has to do after the CDP overrides.

    ``patch_webdriver`` forces ``navigator.webdriver`` to ``False`` from
    JavaScript, which is only needed when the browser was launched by somebody
    else and ``--disable-blink-features=AutomationControlled`` can no longer be
    passed. ``patch_languages`` also patches ``navigator.languages``, which the
    browser already sets from ``acceptLanguage``.

    Returns ``None`` when the browser-side overrides already cover everything.
    """
    config: dict[str, Any] = {}

    if patch_webdriver:
        config["webdriver"] = False
    if "deviceMemory" in profile:
        config["deviceMemory"] = profile["deviceMemory"]
    if "vendor" in profile:
        config["vendor"] = profile["vendor"]
    if "doNotTrack" in profile:
        config["doNotTrack"] = profile["doNotTrack"]
    if patch_languages and "languages" in profile:
        config["languages"] = list(profile["languages"])
    if "webgl" in profile:
        config["webgl"] = dict(profile["webgl"])
    if "screen" in profile:
        screen = {
            field: profile["screen"][field]
            for field in _SCREEN_FIELDS
            if field in profile["screen"]
        }
        # width and height are already enforced by setDeviceMetricsOverride; the
        # avail*/depth fields are not, so only those need patching.
        screen.pop("width", None)
        screen.pop("height", None)
        if screen:
            config["screen"] = screen

    return config or None


def build_fingerprint_init_script(
    profile: Mapping[str, Any],
    *,
    patch_webdriver: bool = False,
    patch_languages: bool = False,
) -> str | None:
    """Serialize the init script for a profile, or ``None`` when none is needed."""
    if not isinstance(profile, Mapping):
        raise TypeError("profile must be a normalized fingerprint profile")
    config = build_init_script_config(
        profile,
        patch_webdriver=patch_webdriver,
        patch_languages=patch_languages,
    )
    if config is None:
        return None
    # The payload is wrapped in an IIFE so the declaration never becomes a
    # property of the page's global object; a stray ``fingerprintPayload``
    # global would be a far louder signal than anything the payload hides.
    payload_config = json.dumps(config, separators=(",", ":"))
    return (
        "(() => {\n"
        f"{FINGERPRINT_PAYLOAD_SOURCE}\n"
        f"fingerprintPayload({payload_config});\n"
        "})();"
    )
