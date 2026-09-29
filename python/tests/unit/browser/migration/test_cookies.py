"""Tests for cookie migration (mirrors cookies.test.js)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from browser_commander.browser.browser_cookie_crypto import derive_chromium_cookie_key
from browser_commander.browser.migration.cookies import (
    DBSC_BOUND_COOKIE_NAMES,
    is_dbsc_bound_cookie,
    migrate_cookies,
)
from tests.helpers.migration_fixtures import (
    encrypt_chromium_cookie_value,
    write_chromium_cookies,
)

if TYPE_CHECKING:
    from pathlib import Path


class TestIsDbscBoundCookie:
    def test_flags_rotating_google_session_token_cookies(self) -> None:
        for name in DBSC_BOUND_COOKIE_NAMES:
            assert is_dbsc_bound_cookie({"name": name, "domain": ".google.com"}), name
        assert not is_dbsc_bound_cookie({"name": "SID", "domain": ".google.com"})
        assert not is_dbsc_bound_cookie(
            {"name": "__Secure-1PSIDTS", "domain": ".example.com"}
        )

    def test_recognises_country_google_hosts(self) -> None:
        assert is_dbsc_bound_cookie({"name": "SIDTS", "domain": "accounts.google.de"})
        assert is_dbsc_bound_cookie({"name": "SIDTS", "domain": ".google.co.uk"})


class TestMigrateCookies:
    def test_dedupes_across_domain_filters_and_tags_dbsc_bound_cookies(self) -> None:
        calls: list[str | None] = []

        def read_cookies(**options: Any) -> list[dict[str, Any]]:
            calls.append(options["domain_filter"])
            if options["domain_filter"] == "google.com":
                return [
                    {"name": "__Secure-1PSIDTS", "domain": ".google.com", "path": "/"},
                    {"name": "SID", "domain": ".google.com", "path": "/"},
                ]
            # The Google cookie shows up again under the second filter.
            return [
                {"name": "session", "domain": ".example.com", "path": "/"},
                {"name": "SID", "domain": ".google.com", "path": "/"},
            ]

        report = migrate_cookies(
            browser="chrome",
            domains=["google.com", "example.com"],
            read_cookies=read_cookies,
        )

        assert calls == ["google.com", "example.com"]
        assert len(report["cookies"]) == 3
        assert report["migrated"] == 3
        assert len(report["skipped"]) == 1
        assert report["skipped"][0]["reason"] == "dbsc-bound"
        assert report["skipped"][0]["item"] == ".google.com __Secure-1PSIDTS"

    def test_warns_when_the_source_has_a_dbsc_registration_database(
        self, tmp_path: Path
    ) -> None:
        (tmp_path / "Network").mkdir()
        (tmp_path / "Network" / "DeviceBoundSessions").write_text("x")

        report = migrate_cookies(
            browser="chrome",
            source_profile_dir=tmp_path,
            read_cookies=lambda **_options: [
                {"name": "a", "domain": ".example.com", "path": "/"}
            ],
        )

        assert len(report["warnings"]) == 1
        assert report["warnings"][0]["reason"] == "dbsc-registration-present"

    def test_passes_ignore_decryption_errors_to_the_reader(self) -> None:
        seen: dict[str, Any] = {}

        def read_cookies(**options: Any) -> list[dict[str, Any]]:
            seen.update(options)
            return []

        migrate_cookies(
            browser="chrome",
            read_cookies=read_cookies,
            reader_options={"platform": "linux"},
        )
        assert seen["ignore_decryption_errors"] is True
        assert seen["domain_filter"] is None
        assert seen["platform"] == "linux"

    def test_reads_an_installed_linux_profile_with_the_default_reader(
        self, tmp_path: Path
    ) -> None:
        profile_dir = tmp_path / ".config" / "google-chrome" / "Default"
        write_chromium_cookies(
            profile_dir,
            [
                {
                    "host": ".example.com",
                    "name": "session",
                    "encrypted_value": encrypt_chromium_cookie_value(
                        host=".example.com",
                        value="cookie-value",
                        key=derive_chromium_cookie_key("peanuts", "linux"),
                        prefix="v10",
                    ),
                    "secure": True,
                },
                {"host": ".other.com", "name": "plain", "value": "text"},
            ],
        )

        report = migrate_cookies(
            browser="chrome",
            domains=["example.com"],
            reader_options={
                "platform": "linux",
                "home_dir": tmp_path,
                "environment": {},
            },
        )

        assert report["migrated"] == 1
        cookie = report["cookies"][0]
        assert cookie["name"] == "session"
        assert cookie["value"] == "cookie-value"
        assert cookie["domain"] == ".example.com"
        assert cookie["secure"] is True
