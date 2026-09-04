"""Client hints derived from a user agent.

Translated from ``js/tests/unit/fingerprint/derive.test.js`` so the two
implementations cannot drift apart unnoticed.
"""

import pytest

from browser_commander.fingerprint.derive import derive_user_agent_data


class TestDeriveUserAgentData:
    def test_returns_none_when_the_string_names_no_chrome_version(self):
        assert (
            derive_user_agent_data(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 "
                "Safari/605.1.15"
            )
            is None
        )

    def test_rejects_a_non_string_user_agent(self):
        with pytest.raises(TypeError, match="must be a string"):
            derive_user_agent_data(None)

    def test_maps_a_windows_user_agent_onto_the_windows_platform_hints(self):
        data = derive_user_agent_data(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/140.0.7000.55 Safari/537.36"
        )

        assert data is not None
        assert data["platform"] == "Windows"
        assert data["architecture"] == "x86"
        assert data["bitness"] == "64"
        assert data["mobile"] is False
        assert data["formFactors"] == ["Desktop"]
        # Chrome froze the user agent at "Windows NT 10.0" and reports the real
        # version only through platformVersion, where 13 and up mean Windows 11.
        assert data["platformVersion"] == "15.0.0"
        assert data["fullVersion"] == "140.0.7000.55"

    def test_pads_a_major_only_version_into_a_four_part_full_version(self):
        data = derive_user_agent_data(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/141 Safari/537.36"
        )

        assert data is not None
        assert data["fullVersion"] == "141.0.0.0"
        assert [entry["version"] for entry in data["brands"]] == ["141", "141", "24"]

    def test_parses_the_macos_version_out_of_the_user_agent(self):
        data = derive_user_agent_data(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
        )

        assert data is not None
        assert data["platform"] == "macOS"
        assert data["platformVersion"] == "10.15.7"

    def test_reports_an_android_phone_as_mobile_and_recovers_the_model(self):
        data = derive_user_agent_data(
            "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A.240105.004) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 "
            "Mobile Safari/537.36"
        )

        assert data is not None
        assert data["platform"] == "Android"
        assert data["platformVersion"] == "14"
        assert data["mobile"] is True
        assert data["model"] == "Pixel 8"
        assert data["formFactors"] == ["Mobile"]

    def test_recognises_linux_and_chrome_os(self):
        linux = derive_user_agent_data(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
        )
        chrome_os = derive_user_agent_data(
            "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
        )

        assert linux is not None and linux["platform"] == "Linux"
        assert chrome_os is not None and chrome_os["platform"] == "Chrome OS"

    def test_includes_the_grease_brand_so_the_list_has_a_real_browser_shape(self):
        data = derive_user_agent_data(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
        )

        assert data is not None
        assert len(data["brands"]) == 3
        assert any(entry["brand"] == "Not=A?Brand" for entry in data["brands"])
        assert all(
            len(entry["version"].split(".")) == 4 for entry in data["fullVersionList"]
        )
