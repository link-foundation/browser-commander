"""Ready-made fingerprint profiles.

Translated from ``js/tests/unit/fingerprint/presets.test.js``. The final
JavaScript case builds CDP commands from every preset; the Python port has no
command builder yet, so it asserts the same underlying property -- that every
preset survives normalization with the fields an override needs.
"""

import pytest

from browser_commander.fingerprint.presets import (
    FINGERPRINT_PRESET_NAMES,
    create_fingerprint_preset,
)


class TestFingerprintPresets:
    def test_names_the_platforms_chrome_ships_on(self):
        assert list(FINGERPRINT_PRESET_NAMES) == [
            "android-chrome",
            "linux-chrome",
            "macos-chrome",
            "windows-chrome",
        ]

    def test_rejects_an_unknown_preset_and_lists_the_known_ones(self):
        with pytest.raises(ValueError) as error:
            create_fingerprint_preset("windows-edge")

        assert 'unknown fingerprint preset "windows-edge"' in str(error.value)
        assert "windows-chrome" in str(error.value)

    def test_rejects_a_chrome_version_that_is_not_a_dotted_number(self):
        for chrome_version in ("latest", "", "140.x"):
            with pytest.raises(ValueError, match="dotted numeric version string"):
                create_fingerprint_preset("linux-chrome", chrome_version=chrome_version)
        with pytest.raises(TypeError, match="dotted numeric version string"):
            create_fingerprint_preset("linux-chrome", chrome_version=140)

    def test_describes_one_machine_consistently(self):
        # Every serious fingerprinting script cross-checks these against each
        # other, so a preset is only useful when they agree.
        expectations = {
            "windows-chrome": ("Win32", "Windows NT 10.0", "Windows", False),
            "macos-chrome": ("MacIntel", "Mac OS X", "macOS", False),
            "linux-chrome": ("Linux x86_64", "X11; Linux x86_64", "Linux", False),
            "android-chrome": ("Linux armv81", "Android 15", "Android", True),
        }

        for name, (platform, ua_token, hint, mobile) in expectations.items():
            profile = create_fingerprint_preset(name)
            assert profile["platform"] == platform, name
            assert ua_token in profile["userAgent"], name
            assert profile["userAgentData"]["platform"] == hint, name
            assert profile["userAgentData"]["mobile"] is mobile, name
            assert profile["viewport"]["mobile"] is mobile, name
            assert ("Mobile Safari" in profile["userAgent"]) is mobile, name
            assert profile["userAgentData"]["formFactors"] == [
                "Mobile" if mobile else "Desktop"
            ], name

    def test_keeps_the_viewport_inside_the_screen_it_claims(self):
        for name in FINGERPRINT_PRESET_NAMES:
            profile = create_fingerprint_preset(name)
            screen = profile["screen"]
            viewport = profile["viewport"]
            assert viewport["width"] <= screen["width"], name
            assert viewport["height"] <= screen["availHeight"], name
            assert screen["availWidth"] <= screen["width"], name
            assert screen["availHeight"] <= screen["height"], name

    def test_gives_touch_points_only_to_the_mobile_preset(self):
        assert create_fingerprint_preset("android-chrome")["maxTouchPoints"] == 5
        for name in ("windows-chrome", "macos-chrome", "linux-chrome"):
            assert create_fingerprint_preset(name)["maxTouchPoints"] == 0, name

    def test_puts_the_requested_chrome_version_everywhere_it_appears(self):
        profile = create_fingerprint_preset(
            "windows-chrome", chrome_version="141.0.7390.55"
        )

        # The user agent carries only the major version, as Chrome freezes it.
        assert "Chrome/141.0.0.0" in profile["userAgent"]
        for entry in profile["userAgentData"]["brands"]:
            assert entry["version"] in ("141", "24"), entry["brand"]
        assert any(
            entry["version"] == "141.0.7390.55"
            for entry in profile["userAgentData"]["fullVersionList"]
        )

    def test_merges_caller_overrides_over_the_preset(self):
        profile = create_fingerprint_preset(
            "linux-chrome",
            overrides={"timezoneId": "Europe/Lisbon", "hardwareConcurrency": 32},
        )

        assert profile["timezoneId"] == "Europe/Lisbon"
        assert profile["hardwareConcurrency"] == 32
        assert profile["platform"] == "Linux x86_64"

    def test_returns_a_normalized_profile_every_preset_can_be_applied_from(self):
        for name in FINGERPRINT_PRESET_NAMES:
            profile = create_fingerprint_preset(name)
            assert profile["acceptLanguage"] == "en-US,en", name
            # The derived uaFullVersion is what a page reads through
            # getHighEntropyValues, so it has to survive normalization.
            assert profile["userAgentData"]["fullVersion"].startswith("140."), name
            for field in ("userAgent", "timezoneId", "screen", "viewport", "webgl"):
                assert field in profile, f"{name}: {field}"

    def test_builds_a_fresh_profile_each_call(self):
        first = create_fingerprint_preset("linux-chrome")
        first["languages"].append("de")

        assert create_fingerprint_preset("linux-chrome")["languages"] == ["en-US", "en"]
