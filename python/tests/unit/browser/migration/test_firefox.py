"""Tests for Firefox to Chromium migration (mirrors firefox.test.js)."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any, Callable

import pytest

from browser_commander.browser.browser_cookie_crypto import derive_chromium_cookie_key
from browser_commander.browser.migration.firefox import (
    migrate_firefox_bookmarks,
    migrate_firefox_passwords,
    read_firefox_cookies,
    report_firefox_history,
)
from tests.helpers.migration_fixtures import (
    assert_nothing_migrated,
    assert_source_unchanged,
    read_migrated_logins,
    read_profile_json,
    write_firefox_cookies,
    write_firefox_logins,
    write_firefox_places,
)

if TYPE_CHECKING:
    from pathlib import Path


class TestReadFirefoxCookies:
    def test_reads_and_maps_cookies_applying_the_domain_filter(
        self, tmp_path: Path
    ) -> None:
        write_firefox_cookies(
            tmp_path,
            [
                {"name": "a", "value": "1", "host": ".example.com", "secure": True},
                {"name": "b", "value": "2", "host": ".other.com"},
            ],
        )

        assert len(read_firefox_cookies(profile_dir=tmp_path)) == 2
        filtered = read_firefox_cookies(profile_dir=tmp_path, domains=["example.com"])
        assert len(filtered) == 1
        assert filtered[0]["domain"] == ".example.com"
        assert filtered[0]["secure"] is True

    def test_maps_the_engine_cookie_shape(self, tmp_path: Path) -> None:
        write_firefox_cookies(
            tmp_path,
            [
                {
                    "name": "sid",
                    "value": "v",
                    "host": "a.example",
                    "path": "/app",
                    "expiry": 2_000_000_000,
                    "http_only": True,
                    "same_site": 2,
                },
            ],
        )
        assert read_firefox_cookies(profile_dir=tmp_path) == [
            {
                "name": "sid",
                "value": "v",
                "domain": "a.example",
                "path": "/app",
                "expires": 2_000_000_000,
                "httpOnly": True,
                "secure": False,
                "sameSite": "Strict",
            }
        ]

    def test_returns_an_empty_list_when_there_is_no_cookies_sqlite(
        self, tmp_path: Path
    ) -> None:
        assert read_firefox_cookies(profile_dir=tmp_path) == []


class TestMigrateFirefoxBookmarks:
    def test_converts_places_bookmarks_into_a_chrome_bookmarks_document(
        self, tmp_path: Path
    ) -> None:
        source = tmp_path / "source"
        target = tmp_path / "target"
        source.mkdir()
        write_firefox_places(source)

        report = migrate_firefox_bookmarks(
            profile_dir=source, target_profile_dir=target
        )

        assert report["migrated"] == 2
        document = read_profile_json(target, "Bookmarks")
        assert (
            document["roots"]["bookmark_bar"]["children"][0]["url"]
            == "https://toolbar.example/"
        )
        assert document["roots"]["other"]["children"][0]["url"] == (
            "https://menu.example/"
        )
        assert document["roots"]["bookmark_bar"]["children"][0]["name"] == (
            "Toolbar Site"
        )

    def test_writes_compact_json_like_javascript(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        target = tmp_path / "target"
        source.mkdir()
        write_firefox_places(source, with_menu_bookmark=False)

        migrate_firefox_bookmarks(profile_dir=source, target_profile_dir=target)

        text = (target / "Bookmarks").read_text(encoding="utf-8")
        assert text == json.dumps(json.loads(text), separators=(",", ":"))

    def test_reports_source_missing_without_places(self, tmp_path: Path) -> None:
        report = migrate_firefox_bookmarks(
            profile_dir=tmp_path, target_profile_dir=tmp_path / "target"
        )
        assert_nothing_migrated(report, "source-missing")


class TestReportFirefoxHistory:
    def test_counts_places_history_and_reports_it_as_not_migrated(
        self, tmp_path: Path
    ) -> None:
        write_firefox_places(tmp_path)
        report = report_firefox_history(profile_dir=tmp_path)
        assert_nothing_migrated(report, "firefox-history-schema-incompatible")
        assert "2 history entries" in report["warnings"][0]["detail"]


def _no_source(_source: Path) -> None:
    """Leave the source profile empty."""


def _locked_source(source: Path) -> None:
    """Write logins protected by a Firefox primary password."""

    write_firefox_logins(
        source,
        primary_password=b"locked",
        entries=[{"hostname": "https://a.example", "username": "a", "password": "b"}],
    )


class TestMigrateFirefoxPasswords:
    def test_decrypts_logins_and_reencrypts_them_into_a_chrome_login_data(
        self, tmp_path: Path
    ) -> None:
        source = tmp_path / "source"
        target = tmp_path / "target"
        source.mkdir()
        fixture = write_firefox_logins(
            source,
            entries=[
                {
                    "hostname": "https://a.example",
                    "username": "alice",
                    "password": "secret-A",
                }
            ],
        )
        assert fixture["key4_path"] == source / "key4.db"

        target_key = derive_chromium_cookie_key("target-pass", "linux")
        report = assert_source_unchanged(
            fixture["key4_path"],
            lambda: migrate_firefox_passwords(
                profile_dir=source,
                target_profile_dir=target,
                platform="linux",
                target_key=target_key,
                target_prefix="v11",
            ),
        )
        assert report["migrated"] == 1
        assert report["warnings"][0]["reason"] == "reencrypted-for-chrome"

        [login] = read_migrated_logins(target, target_key)
        assert login["username"] == "alice"
        assert login["password"] == "secret-A"

    def test_unlocks_with_the_supplied_primary_password(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()
        write_firefox_logins(
            source,
            primary_password=b"open sesame",
            entries=[
                {"hostname": "https://b.example", "username": "bob", "password": "pw"}
            ],
        )
        target_key = derive_chromium_cookie_key("t", "darwin")

        report = migrate_firefox_passwords(
            profile_dir=source,
            target_profile_dir=tmp_path / "target",
            platform="darwin",
            target_key=target_key,
            primary_password="open sesame",
        )

        assert report["migrated"] == 1
        [login] = read_migrated_logins(tmp_path / "target", target_key, "darwin")
        assert login["password"] == "pw"

    def test_reencrypts_with_aes_gcm_on_windows(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()
        write_firefox_logins(
            source,
            entries=[
                {"hostname": "https://w.example", "username": "win", "password": "pw"}
            ],
        )
        target_key = bytes(range(32))

        report = migrate_firefox_passwords(
            profile_dir=source,
            target_profile_dir=tmp_path / "target",
            platform="win32",
            target_key=target_key,
        )

        assert report["migrated"] == 1
        [login] = read_migrated_logins(tmp_path / "target", target_key, "win32")
        assert login["password"] == "pw"

    @pytest.mark.parametrize(
        ("reason", "write_source"),
        [
            ("primary-password-set", _locked_source),
            ("source-missing", _no_source),
        ],
    )
    def test_reports_why_no_passwords_could_be_read(
        self,
        tmp_path: Path,
        reason: str,
        write_source: Callable[[Path], Any],
    ) -> None:
        source = tmp_path / "source"
        source.mkdir()
        write_source(source)

        report = migrate_firefox_passwords(
            profile_dir=source,
            target_profile_dir=tmp_path / "target",
            platform="linux",
            target_key=derive_chromium_cookie_key("t", "linux"),
        )

        assert_nothing_migrated(report, reason)

    def test_requires_a_target_key(self, tmp_path: Path) -> None:
        write_firefox_logins(
            tmp_path,
            entries=[
                {"hostname": "https://a.example", "username": "a", "password": "b"}
            ],
        )
        with pytest.raises(TypeError, match="target key"):
            migrate_firefox_passwords(
                profile_dir=tmp_path,
                target_profile_dir=tmp_path / "target",
                platform="linux",
                target_key=None,
            )
