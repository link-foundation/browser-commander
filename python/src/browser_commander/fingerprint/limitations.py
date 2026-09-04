"""What Browser Commander cannot make identical, and why.

Issue 79 asks for the limitations to be stated clearly rather than implied, so
every entry names the surface, the mechanism that would be needed, the privacy
consequence, and the evidence it rests on. Entries marked ``measured`` were
reproduced in this repository; the artifacts are under
``docs/case-studies/issue-79/analysis-artifacts/``.

The catalogue itself is data, not code: ``limitations.json`` next to this
module is a byte-for-byte copy of ``js/src/fingerprint/limitations.json``, kept
in step by ``scripts/check-shared-fingerprint-assets.sh``. Three hand-written
translations of the same eleven paragraphs would drift within a release.

``severity`` describes how much the limitation helps someone identify the
browser as automated or as a specific machine: ``high`` means it identifies
automation or the physical machine on its own, ``medium`` means it is a strong
signal in combination, and ``low`` means it narrows the field but is common in
real browsers too.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from types import MappingProxyType
from typing import Any

_CATALOGUE_PATH = Path(__file__).parent / "limitations.json"

#: Every documented limitation, in the order the catalogue declares them.
#:
#: Read-only, because a caller that could edit the catalogue could hide an
#: entry from a later reader without changing anything the tests see.
FINGERPRINT_LIMITATIONS: tuple[Mapping[str, Any], ...] = tuple(
    MappingProxyType(entry)
    for entry in json.loads(_CATALOGUE_PATH.read_text(encoding="utf-8"))
)

#: Limitations that apply no matter what the profile asks for.
_ALWAYS_RELEVANT = frozenset(
    {"canvas-audio-font-follow-the-host", "network-layer-not-covered"}
)

#: Fields a worker reads differently from its document: the ones no override
#: reaches, plus the ones the page session keeps to itself.
_WORKER_VISIBLE_FIELDS = (
    "deviceMemory",
    "vendor",
    "doNotTrack",
    "webgl",
    "platform",
    "languages",
    "hardwareConcurrency",
)


def find_fingerprint_limitation(limitation_id: str) -> Mapping[str, Any] | None:
    """Look a limitation up by id, or return ``None`` when there is no such id."""
    for limitation in FINGERPRINT_LIMITATIONS:
        if limitation["id"] == limitation_id:
            return limitation
    return None


def _screen_needs_patching(profile: Mapping[str, Any]) -> bool:
    screen = profile.get("screen")
    if not isinstance(screen, Mapping):
        return False
    return any(
        screen.get(field) is not None
        for field in ("colorDepth", "pixelDepth", "availWidth", "availHeight")
    )


def relevant_fingerprint_limitations(
    profile: Mapping[str, Any] | None = None,
    *,
    headless: bool = False,
    attached: bool = False,
) -> tuple[Mapping[str, Any], ...]:
    """The limitations that apply to a specific profile.

    A profile that never touches WebGL does not need to hear about the WebGL
    limitation, and hiding the irrelevant entries is what makes the relevant
    ones worth reading.

    :param profile: A fingerprint profile, resolved or raw.
    :param headless: Whether the browser runs headless.
    :param attached: Whether the browser was launched by somebody else, so the
        automation switches are already fixed.
    """
    profile = profile or {}
    conditions = {
        "automation-controlled-is-launch-only": attached,
        "no-cdp-device-memory-override": profile.get("deviceMemory") is not None,
        "no-cdp-vendor-or-dnt-override": (
            profile.get("vendor") is not None or profile.get("doNotTrack") is not None
        ),
        "screen-depth-and-avail-not-emulated": _screen_needs_patching(profile),
        "webgl-strings-only": profile.get("webgl") is not None,
        "grease-brand-not-reproduced": profile.get("userAgentData") is not None,
        "touch-emulation-changes-pointer-media": (profile.get("maxTouchPoints") or 0)
        > 0,
        "headless-is-distinguishable": headless,
        "init-script-does-not-reach-workers": any(
            profile.get(field) is not None for field in _WORKER_VISIBLE_FIELDS
        ),
    }

    return tuple(
        limitation
        for limitation in FINGERPRINT_LIMITATIONS
        if limitation["id"] in _ALWAYS_RELEVANT
        or conditions.get(limitation["id"], False)
    )


__all__ = [
    "FINGERPRINT_LIMITATIONS",
    "find_fingerprint_limitation",
    "relevant_fingerprint_limitations",
]
