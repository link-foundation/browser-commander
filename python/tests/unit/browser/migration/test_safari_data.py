"""Shared Safari source fixtures: never use the host's browser profile."""

import contextlib
import errno
import shutil
import sqlite3
from pathlib import Path

import pytest

from browser_commander.browser.browser_cookie_crypto import (
    decrypt_chromium_cookie,
    derive_chromium_cookie_key,
)
from browser_commander.browser.migration.profile import migrate_profile_sync
from browser_commander.browser.migration.safari import (
    read_safari_bookmarks,
    read_safari_history,
    read_safari_passwords,
    with_safari_access,
)

FIXTURES = Path(__file__).resolve().parents[5] / "tests/fixtures/safari-data"


@pytest.mark.parametrize("format_", ["binary", "xml"])
def test_plist_tree_and_reading_list(format_):
    filename = FIXTURES / f"Bookmarks-{format_}.plist"
    before = filename.read_bytes()
    tree = read_safari_bookmarks(filename)
    assert tree[0]["name"] == "Work"
    assert tree[0]["children"][0]["name"] == "Foundation ☃"
    assert tree[1]["children"][0]["readingList"] is True
    assert filename.read_bytes() == before


def test_history_preserves_filtered_visits_and_source():
    filename = FIXTURES / "History.db"
    before = filename.read_bytes()
    entries = read_safari_history(filename, ["github.com"])
    assert len(entries) == 2
    assert entries[0]["time"] == 1778307200250000
    assert filename.read_bytes() == before


def test_explicit_quoted_utf8_password_csv():
    assert read_safari_passwords(FIXTURES / "Passwords.csv", ["github.com"]) == [
        {"origin": "https://github.com/login", "username": "a,b", "password": 'p"a\nss'}
    ]


def test_custom_source_translates_and_encrypts_for_chromium(tmp_path):
    source = tmp_path / "safari"
    target = tmp_path / "target"
    source.mkdir()
    shutil.copyfile(FIXTURES / "Bookmarks-binary.plist", source / "Bookmarks.plist")
    shutil.copyfile(FIXTURES / "History.db", source / "History.db")
    key = derive_chromium_cookie_key("target", "linux")
    report = migrate_profile_sync(
        from_={"browser": "safari", "user_data_dir": source},
        to=target,
        include=["bookmarks", "history", "passwords"],
        domains=["github.com"],
        password_csv=FIXTURES / "Passwords.csv",
        platform="linux",
        keys={"target_key": key, "target_prefix": "v11"},
    )
    assert report["migrated"]["bookmarks"] == 2
    assert any(
        entry["reason"] == "safari-reading-list-translated"
        for entry in report["warnings"]
    )
    assert report["migrated"]["history"] == 2
    assert report["migrated"]["passwords"] == 1
    assert report["skipped"] == []
    with contextlib.closing(sqlite3.connect(target / "Login Data")) as db:
        rows = db.execute("SELECT password_value FROM logins").fetchall()
        assert len(rows) == 1
        assert (
            decrypt_chromium_cookie(
                encrypted_value=rows[0][0],
                key=key,
                platform="linux",
                database_version=0,
                host="github.com",
            )
            == 'p"a\nss'
        )


@pytest.mark.parametrize("code", [errno.EPERM, errno.EACCES])
def test_non_cookie_protection_names_executing_application(monkeypatch, code):
    monkeypatch.setenv("TERM_PROGRAM", "FixtureTerminal")
    monkeypatch.delenv("__CFBundleIdentifier", raising=False)

    def denied():
        raise PermissionError(code, "protected")

    with pytest.raises(
        PermissionError, match=r"Full Disk Access to FixtureTerminal.*Privacy_AllFiles"
    ):
        with_safari_access("/Safari/History.db", denied)
