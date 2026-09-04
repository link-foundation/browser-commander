"""Fingerprint profile normalization.

Translated from ``js/tests/unit/fingerprint/profile.test.js``. The one
deliberate difference is the frozen-object assertion: JavaScript freezes the
returned profile, while the Python port returns a fresh dict and copies every
list, so the property that matters -- a caller cannot reach into a profile that
was already handed out -- is asserted instead of object identity.
"""

import pytest

from browser_commander.fingerprint.profile import (
    FINGERPRINT_FIELD_MECHANISMS,
    resolve_fingerprint_profile,
)

CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)


class TestResolveFingerprintProfile:
    def test_returns_an_empty_profile_for_an_empty_input(self):
        assert resolve_fingerprint_profile() == {}
        assert resolve_fingerprint_profile({}) == {}

    def test_drops_fields_that_were_not_supplied_instead_of_filling_defaults(self):
        profile = resolve_fingerprint_profile({"locale": "de-DE"})

        assert list(profile) == ["locale"]

    def test_rejects_an_unknown_field_rather_than_silently_ignoring_it(self):
        with pytest.raises(
            ValueError, match='unknown fingerprint profile field "hardwareConcurency"'
        ):
            resolve_fingerprint_profile({"hardwareConcurency": 8})

    def test_rejects_a_profile_that_is_not_a_mapping(self):
        for value in ([], "profile", 42):
            with pytest.raises(
                TypeError, match="fingerprint profile must be a mapping"
            ):
                resolve_fingerprint_profile(value)

    def test_derives_accept_language_from_languages(self):
        profile = resolve_fingerprint_profile({"languages": ["de-DE", "de", "en"]})

        assert profile["acceptLanguage"] == "de-DE,de,en"
        assert profile["languages"] == ["de-DE", "de", "en"]

    def test_keeps_an_explicit_accept_language_over_the_derived_one(self):
        profile = resolve_fingerprint_profile(
            {"languages": ["de-DE", "de"], "acceptLanguage": "fr-FR,fr"}
        )

        assert profile["acceptLanguage"] == "fr-FR,fr"

    def test_rejects_q_values_in_accept_language(self):
        # Chrome splits acceptLanguage on commas without stripping q-values, so
        # a q-value ends up inside a language tag and doubled in the header.
        with pytest.raises(
            ValueError, match="plain comma-separated language list without q-values"
        ):
            resolve_fingerprint_profile({"acceptLanguage": "de-DE,de;q=0.9"})

    def test_derives_client_hints_from_a_chrome_user_agent(self):
        profile = resolve_fingerprint_profile({"userAgent": CHROME_UA})

        hints = profile["userAgentData"]
        assert hints["platform"] == "Windows"
        assert hints["architecture"] == "x86"
        assert hints["bitness"] == "64"
        assert hints["mobile"] is False
        assert any(
            entry["brand"] == "Google Chrome" and entry["version"] == "140"
            for entry in hints["brands"]
        )

    def test_fills_ua_full_version_from_the_chrome_entry_of_full_version_list(self):
        profile = resolve_fingerprint_profile(
            {
                "userAgentData": {
                    "fullVersionList": [
                        {"brand": "Not=A?Brand", "version": "24.0.0.0"},
                        {"brand": "Google Chrome", "version": "140.0.7000.1"},
                    ]
                }
            }
        )

        assert profile["userAgentData"]["fullVersion"] == "140.0.7000.1"

    def test_keeps_an_explicit_full_version_instead_of_deriving_one(self):
        profile = resolve_fingerprint_profile(
            {
                "userAgentData": {
                    "fullVersion": "99.1.2.3",
                    "fullVersionList": [
                        {"brand": "Google Chrome", "version": "140.0.0.0"}
                    ],
                }
            }
        )

        assert profile["userAgentData"]["fullVersion"] == "99.1.2.3"

    def test_lets_explicit_user_agent_data_win_over_the_derived_one(self):
        profile = resolve_fingerprint_profile(
            {"userAgent": CHROME_UA, "userAgentData": {"platform": "macOS"}}
        )

        assert profile["userAgentData"]["platform"] == "macOS"

    def test_accepts_every_configurable_field_at_once(self):
        profile = resolve_fingerprint_profile(
            {
                "userAgent": CHROME_UA,
                "languages": ["de-DE", "de"],
                "locale": "de-DE",
                "timezoneId": "Europe/Berlin",
                "platform": "Win32",
                "vendor": "Google Inc.",
                "hardwareConcurrency": 24,
                "deviceMemory": 32,
                "maxTouchPoints": 5,
                "doNotTrack": "1",
                "screen": {
                    "width": 3840,
                    "height": 2160,
                    "availWidth": 3840,
                    "availHeight": 2100,
                    "colorDepth": 30,
                    "pixelDepth": 30,
                },
                "viewport": {
                    "width": 1600,
                    "height": 900,
                    "deviceScaleFactor": 2,
                    "mobile": False,
                },
                "webgl": {"unmaskedVendor": "NVIDIA", "unmaskedRenderer": "RTX 4090"},
                "geolocation": {
                    "latitude": 52.52,
                    "longitude": 13.405,
                    "accuracy": 12,
                },
                "colorScheme": "dark",
                "reducedMotion": "reduce",
                "forcedColors": "active",
            }
        )

        assert profile["hardwareConcurrency"] == 24
        assert profile["deviceMemory"] == 32
        assert profile["screen"]["colorDepth"] == 30
        assert profile["viewport"]["deviceScaleFactor"] == 2
        assert profile["webgl"]["unmaskedRenderer"] == "RTX 4090"
        assert profile["geolocation"]["accuracy"] == 12
        assert profile["forcedColors"] == "active"

    def test_rejects_a_hardware_concurrency_that_is_not_a_positive_integer(self):
        for value in (0, -4, 2.5, "8", True):
            with pytest.raises(
                TypeError, match="hardwareConcurrency must be a positive integer"
            ):
                resolve_fingerprint_profile({"hardwareConcurrency": value})

    def test_allows_max_touch_points_to_be_zero_but_not_negative(self):
        assert resolve_fingerprint_profile({"maxTouchPoints": 0})["maxTouchPoints"] == 0
        with pytest.raises(
            TypeError, match="maxTouchPoints must be a non-negative integer"
        ):
            resolve_fingerprint_profile({"maxTouchPoints": -1})

    def test_requires_screen_width_and_height_together(self):
        with pytest.raises(
            ValueError, match=r"screen\.width and screen\.height must be provided"
        ):
            resolve_fingerprint_profile({"screen": {"width": 1920}})

    def test_requires_viewport_width_and_height_together(self):
        with pytest.raises(
            ValueError, match=r"viewport\.width and viewport\.height must be provided"
        ):
            resolve_fingerprint_profile({"viewport": {"height": 900}})

    def test_rejects_out_of_range_coordinates(self):
        with pytest.raises(ValueError, match="latitude must be between -90 and 90"):
            resolve_fingerprint_profile(
                {"geolocation": {"latitude": 91, "longitude": 0}}
            )
        with pytest.raises(ValueError, match="longitude must be between -180 and 180"):
            resolve_fingerprint_profile(
                {"geolocation": {"latitude": 0, "longitude": -181}}
            )

    def test_rejects_an_unsupported_enum_value(self):
        with pytest.raises(
            ValueError, match="colorScheme must be one of light, dark, no-preference"
        ):
            resolve_fingerprint_profile({"colorScheme": "sepia"})

    def test_rejects_an_empty_languages_list(self):
        with pytest.raises(ValueError, match="languages must not be empty"):
            resolve_fingerprint_profile({"languages": []})

    def test_rejects_a_brand_entry_with_a_non_string_version(self):
        with pytest.raises(
            TypeError, match=r"userAgentData\.brands\[0\]\.version must be a string"
        ):
            resolve_fingerprint_profile(
                {"userAgentData": {"brands": [{"brand": "Chromium", "version": 140}]}}
            )

    def test_treats_none_the_same_as_an_omitted_field(self):
        assert (
            resolve_fingerprint_profile({"locale": None, "screen": None, "webgl": None})
            == {}
        )

    def test_copies_lists_so_a_later_mutation_cannot_reach_the_profile(self):
        languages = ["de-DE", "de"]
        profile = resolve_fingerprint_profile({"languages": languages})
        languages.append("en")

        assert profile["languages"] == ["de-DE", "de"]

    def test_records_a_mechanism_for_every_field_the_profile_accepts(self):
        every_field = resolve_fingerprint_profile(
            {
                "userAgent": CHROME_UA,
                "acceptLanguage": "en-US,en",
                "languages": ["en-US", "en"],
                "locale": "en-US",
                "timezoneId": "UTC",
                "platform": "Win32",
                "vendor": "Google Inc.",
                "hardwareConcurrency": 8,
                "deviceMemory": 8,
                "maxTouchPoints": 0,
                "doNotTrack": "1",
                "screen": {"width": 1920, "height": 1080},
                "viewport": {"width": 1280, "height": 720},
                "webgl": {"unmaskedVendor": "Intel"},
                "geolocation": {"latitude": 0, "longitude": 0},
                "colorScheme": "dark",
                "reducedMotion": "reduce",
                "forcedColors": "active",
            }
        )

        for field in every_field:
            assert FINGERPRINT_FIELD_MECHANISMS[field] in ("browser", "script"), field

    def test_mirrors_the_javascript_mechanism_table(self):
        # The mechanism decides how strong an override is, so the two ports
        # disagreeing here would be a documentation bug with teeth.
        assert dict(FINGERPRINT_FIELD_MECHANISMS) == {
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
