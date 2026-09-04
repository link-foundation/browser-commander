"""Tests for the page init script.

The config half mirrors ``js/tests/unit/fingerprint/init-script.test.js``. The
payload itself is a shared asset rather than a translation, so instead of
re-testing its behaviour in a Python re-implementation of a browser realm, the
last test runs the script Python generates through Node and checks the values a
page would read.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from browser_commander.fingerprint.init_script import (
    FINGERPRINT_PAYLOAD_SOURCE,
    build_fingerprint_init_script,
    build_init_script_config,
)
from browser_commander.fingerprint.profile import resolve_fingerprint_profile

_REPO_ROOT = Path(__file__).resolve().parents[4]


def test_rejects_anything_that_is_not_a_profile_mapping() -> None:
    for value in (None, "windows", 42):
        with pytest.raises(TypeError, match="must be a normalized fingerprint profile"):
            build_fingerprint_init_script(value)  # type: ignore[arg-type]


def test_returns_none_when_the_browser_side_overrides_cover_everything() -> None:
    profile = resolve_fingerprint_profile(
        {
            "userAgent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0",
            "timezoneId": "UTC",
            "hardwareConcurrency": 8,
            "maxTouchPoints": 0,
        }
    )

    assert build_init_script_config(profile) is None
    assert build_fingerprint_init_script(profile) is None


def test_patches_only_the_fields_the_emulation_domain_has_no_command_for() -> None:
    config = build_init_script_config(
        resolve_fingerprint_profile(
            {
                "deviceMemory": 8,
                "vendor": "Google Inc.",
                "doNotTrack": "1",
                "hardwareConcurrency": 8,
                "timezoneId": "UTC",
            }
        )
    )

    # hardwareConcurrency and timezoneId are browser-enforced, so they must not
    # appear in the weaker JavaScript patch.
    assert config is not None
    assert sorted(config) == ["deviceMemory", "doNotTrack", "vendor"]


def test_adds_webdriver_only_when_the_caller_asks_for_it() -> None:
    profile = resolve_fingerprint_profile({"vendor": "Google Inc."})

    assert "webdriver" not in (build_init_script_config(profile) or {})
    patched = build_init_script_config(profile, patch_webdriver=True)
    assert patched is not None
    assert patched["webdriver"] is False


def test_patches_webdriver_even_for_an_otherwise_empty_profile() -> None:
    script = build_fingerprint_init_script(
        resolve_fingerprint_profile({}), patch_webdriver=True
    )

    assert script is not None
    assert '"webdriver":false' in script


def test_leaves_languages_to_the_browser_unless_explicitly_asked() -> None:
    profile = resolve_fingerprint_profile({"languages": ["fr-FR", "fr"]})

    assert build_init_script_config(profile) is None
    patched = build_init_script_config(profile, patch_languages=True)
    assert patched is not None
    assert patched["languages"] == ["fr-FR", "fr"]


def test_drops_the_screen_dimensions_the_device_metrics_override_enforces() -> None:
    config = build_init_script_config(
        resolve_fingerprint_profile(
            {
                "screen": {
                    "width": 1920,
                    "height": 1080,
                    "availWidth": 1920,
                    "availHeight": 1032,
                    "colorDepth": 24,
                    "pixelDepth": 24,
                }
            }
        )
    )

    assert config is not None
    assert sorted(config["screen"]) == [
        "availHeight",
        "availWidth",
        "colorDepth",
        "pixelDepth",
    ]


def test_skips_the_screen_patch_when_only_width_and_height_are_given() -> None:
    assert (
        build_init_script_config(
            resolve_fingerprint_profile({"screen": {"width": 1920, "height": 1080}})
        )
        is None
    )


def test_copies_the_values_it_takes_from_the_profile() -> None:
    profile = resolve_fingerprint_profile(
        {"languages": ["de-DE", "de"], "webgl": {"vendor": "WebKit"}}
    )
    config = build_init_script_config(profile, patch_languages=True)

    assert config is not None
    config["languages"].append("en")
    config["webgl"]["vendor"] = "changed"
    assert profile["languages"] == ["de-DE", "de"]
    assert profile["webgl"] == {"vendor": "WebKit"}


def test_carries_the_shared_payload_asset_and_nothing_else() -> None:
    # The payload is one file that JavaScript and Rust send byte for byte, so
    # this package must ship the file rather than a translation of it.
    # scripts/check-shared-init-payload.sh guards the copies.
    script = build_fingerprint_init_script(
        resolve_fingerprint_profile({"vendor": "Google Inc."})
    )

    assert script is not None
    assert FINGERPRINT_PAYLOAD_SOURCE in script
    assert re.search(
        r"^function fingerprintPayload\(", FINGERPRINT_PAYLOAD_SOURCE, re.M
    )
    assert not re.search(r"^(import|export)\s", FINGERPRINT_PAYLOAD_SOURCE, re.M)


def test_ships_the_payload_that_the_javascript_package_owns() -> None:
    canonical = (_REPO_ROOT / "js/src/fingerprint/init-payload.js").read_text(
        encoding="utf-8"
    )

    assert canonical == FINGERPRINT_PAYLOAD_SOURCE


_FAKE_REALM = """
function Navigator() {}
function Screen() {}
function WebGLRenderingContext() {}
function WebGL2RenderingContext() {}
for (const property of ['deviceMemory', 'vendor', 'doNotTrack', 'language',
                        'languages', 'platform', 'hardwareConcurrency']) {
  Object.defineProperty(Navigator.prototype, property, {
    get() { return 'real'; },
    enumerable: true,
    configurable: true,
  });
}
for (const property of ['width', 'height', 'availWidth', 'availHeight',
                        'colorDepth', 'pixelDepth']) {
  Object.defineProperty(Screen.prototype, property, {
    get() { return 1; },
    enumerable: true,
    configurable: true,
  });
}
for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
  globalThis[name].prototype.getParameter = function getParameter(p) {
    return 'real-' + p;
  };
}
globalThis.navigator = new Navigator();
globalThis.screen = new Screen();
globalThis.gl = new WebGLRenderingContext();
"""

_REPORT = """
console.log(JSON.stringify({
  deviceMemory: navigator.deviceMemory,
  vendor: navigator.vendor,
  webdriver: navigator.webdriver,
  languages: Array.from(navigator.languages),
  availHeight: screen.availHeight,
  width: screen.width,
  unmaskedVendor: gl.getParameter(0x9245),
  otherParameter: gl.getParameter(0x1234),
  nativeSource: Object.getOwnPropertyDescriptor(
    Navigator.prototype, 'deviceMemory').get.toString(),
  leakedHelper: typeof fingerprintPayload,
}));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_script_python_generates_patches_a_page_like_realm() -> None:
    script = build_fingerprint_init_script(
        resolve_fingerprint_profile(
            {
                "deviceMemory": 8,
                "vendor": "Google Inc.",
                "languages": ["de-DE", "de"],
                "screen": {"width": 1920, "height": 1080, "availHeight": 1032},
                "webgl": {"unmaskedVendor": "Google Inc. (NVIDIA)"},
            }
        ),
        patch_webdriver=True,
        patch_languages=True,
    )
    assert script is not None

    completed = subprocess.run(
        [shutil.which("node") or "node", "-e", _FAKE_REALM + script + _REPORT],
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
    )
    seen: dict[str, Any] = json.loads(completed.stdout)

    assert seen == {
        "deviceMemory": 8,
        "vendor": "Google Inc.",
        "webdriver": False,
        "languages": ["de-DE", "de"],
        "availHeight": 1032,
        # width stays with the browser-side setDeviceMetricsOverride.
        "width": 1,
        "unmaskedVendor": "Google Inc. (NVIDIA)",
        "otherParameter": "real-4660",
        "nativeSource": "function get deviceMemory() { [native code] }",
        # The payload runs inside an IIFE, so it leaves no global behind.
        "leakedHelper": "undefined",
    }
