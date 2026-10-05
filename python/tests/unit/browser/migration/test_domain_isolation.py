import contextlib
import sqlite3
from pathlib import Path

from browser_commander.browser.browser_cookie_crypto import derive_chromium_cookie_key
from browser_commander.browser.migration.chromium_crypto import encrypt_chromium_value
from browser_commander.browser.migration.history import migrate_history
from browser_commander.browser.migration.passwords import migrate_passwords


def test_history_domain_isolation_preserves_matching_visits(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    target = tmp_path / "target"
    with contextlib.closing(sqlite3.connect(source / "History")) as db:
        db.executescript(
            (
                Path(__file__).resolve().parents[5]
                / "tests/fixtures/history-domain-isolation.sql"
            ).read_text()
        )
    migrate_history(
        source_profile_dir=source, target_profile_dir=target, domains=["github.com"]
    )
    with contextlib.closing(sqlite3.connect(target / "History")) as db:
        assert db.execute("SELECT count(*) FROM urls").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM visits").fetchone()[0] == 1
        for table in [
            "content_annotations",
            "context_annotations",
            "segment_usage",
            "downloads",
            "downloads_url_chains",
            "downloads_slices",
        ]:
            assert db.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 1, table


def test_password_domain_isolation_removes_undecryptable_values(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    target = tmp_path / "target"
    key = derive_chromium_cookie_key("source", "linux")
    with contextlib.closing(sqlite3.connect(source / "Login Data")) as db:
        db.execute("CREATE TABLE logins(origin_url TEXT,password_value BLOB)")
        db.executemany(
            "INSERT INTO logins VALUES (?,?)",
            [
                (
                    "https://github.com",
                    encrypt_chromium_value(
                        "secret", key=key, platform="linux", prefix="v11"
                    ),
                ),
                ("https://notgithub.com", b"v20unreadable"),
                ("https://locked.github.com", b"v20unreadable"),
            ],
        )
        db.commit()
    report = migrate_passwords(
        source_profile_dir=source,
        target_profile_dir=target,
        domains=["github.com"],
        platform="linux",
        resolve_source_key=lambda _prefix: key,
        target_key=key,
    )
    assert report["migrated"] == 1
    with contextlib.closing(sqlite3.connect(target / "Login Data")) as db:
        assert db.execute("SELECT origin_url FROM logins").fetchall() == [
            ("https://github.com",)
        ]
