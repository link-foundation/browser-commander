import contextlib
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from browser_commander.browser.browser_cookie_crypto import decrypt_chromium_cookie
from browser_commander.browser.migration.chromium_crypto import encrypt_chromium_value
from browser_commander.browser.migration.password_store import (
    assert_password_target_closed,
)
from browser_commander.browser.migration.passwords import migrate_passwords

SCHEMA = (
    Path(__file__).resolve().parents[5] / "tests/fixtures/password-refresh.sql"
).read_text()


@pytest.mark.skipif(sys.platform == "win32", reason="Unix symlink path aliases")
def test_live_target_through_alias_with_spaces_is_refused(tmp_path):
    target = tmp_path / "profile with spaces"
    target.mkdir()
    alias = tmp_path / "alias"
    alias.symlink_to(tmp_path, target_is_directory=True)
    child = subprocess.Popen(
        [
            sys.executable,
            "-c",
            "import time; time.sleep(15)",
            f"--user-data-dir={alias / target.name}",
        ]
    )
    try:
        with pytest.raises(ValueError, match="target-active"):
            assert_password_target_closed(target)
    finally:
        child.terminate()
        child.wait()


def fixture(tmp_path):
    source, target = tmp_path / "source", tmp_path / "target"
    source.mkdir()
    target.mkdir()
    source_key, target_key = os.urandom(16), os.urandom(16)
    for directory, key, rows in [
        (
            source,
            source_key,
            [
                ("https://login.live.com", "shared", "source-conflict"),
                ("https://new.live.com", "new", "new-secret"),
                ("https://notlive.com", "excluded", "excluded-secret"),
            ],
        ),
        (
            target,
            target_key,
            [
                ("https://example.test", "unrelated", "unrelated-secret"),
                ("https://login.live.com", "shared", "target-conflict"),
                ("https://only.live.com", "only", "target-only"),
            ],
        ),
    ]:
        with contextlib.closing(sqlite3.connect(directory / "Login Data")) as db:
            db.executescript(SCHEMA)
            for index, (origin, username, password) in enumerate(rows, 1):
                encrypted = encrypt_chromium_value(
                    password, key=key, platform="linux", prefix="v11"
                )
                db.execute(
                    "INSERT INTO logins VALUES (?,?,?,?,?,?,?,?,?)",
                    (
                        index,
                        origin,
                        "",
                        username,
                        "",
                        f"{origin}/",
                        encrypted,
                        13300000000000001,
                        13300000000000002,
                    ),
                )
            note = encrypt_chromium_value(
                "source-note" if directory == source else "target-note",
                key=key,
                platform="linux",
                prefix="v11",
            )
            db.execute(
                "INSERT INTO password_notes VALUES (1,2,?,?,123,1)", ("note", note)
            )
            db.executescript(
                "INSERT INTO insecure_credentials VALUES (2,0); INSERT INTO sync_model_metadata VALUES (1,'private-sync-state')"
            )
            db.commit()

    def run():
        return migrate_passwords(
            source_profile_dir=source,
            target_profile_dir=target,
            platform="linux",
            resolve_source_key=lambda _: source_key,
            target_key=target_key,
            domains=["live.com"],
        )

    return source, target, target_key, run


def test_scoped_refresh_preserves_credentials_metadata_and_is_idempotent(tmp_path):
    source, target, key, run = fixture(tmp_path)
    original = (source / "Login Data").read_bytes()
    report = run()
    assert report["migrated"] == 1
    assert any(entry["reason"] == "target-existing" for entry in report["skipped"])
    with contextlib.closing(sqlite3.connect(target / "Login Data")) as db:
        rows = db.execute("SELECT * FROM logins ORDER BY origin_url").fetchall()
        assert len(rows) == 4
        assert [
            decrypt_chromium_cookie(
                row[6], host="", database_version=0, platform="linux", key=key
            )
            for row in rows
        ] == ["unrelated-secret", "target-conflict", "new-secret", "target-only"]
        assert rows[2][7] == 13300000000000001
        notes = db.execute(
            "SELECT logins.origin_url,password_notes.value FROM password_notes JOIN logins ON logins.id=password_notes.parent_id ORDER BY logins.origin_url"
        ).fetchall()
        assert [
            (
                origin,
                decrypt_chromium_cookie(
                    value, host="", database_version=0, platform="linux", key=key
                ),
            )
            for origin, value in notes
        ] == [
            ("https://login.live.com", "target-note"),
            ("https://new.live.com", "source-note"),
        ]
        assert db.execute(
            "SELECT origin_url FROM insecure_credentials JOIN logins ON logins.id=insecure_credentials.parent_id ORDER BY origin_url"
        ).fetchall() == [("https://login.live.com",), ("https://new.live.com",)]
        assert db.execute("SELECT count(*) FROM password_notes").fetchone()[0] == 2
        assert (
            db.execute("SELECT count(*) FROM insecure_credentials").fetchone()[0] == 2
        )
        assert (
            db.execute("SELECT model_metadata FROM sync_model_metadata").fetchone()[0]
            == "private-sync-state"
        )
    before = (target / "Login Data").read_bytes()
    assert run()["migrated"] == 0
    assert (target / "Login Data").read_bytes() == before
    assert (source / "Login Data").read_bytes() == original
    assert not any(
        secret in json.dumps(report)
        for secret in [
            "shared",
            "new-secret",
            "source-note",
            "target-note",
            "private-sync-state",
        ]
    )


@pytest.mark.parametrize(
    "kind",
    [
        "active",
        "schema",
        "metadata",
        "version",
        "trigger",
        "wal",
        "journal",
        "account-source",
        "account-target",
        "key",
    ],
)
def test_refusal_keeps_target_bytes(tmp_path, kind):
    source, target, _, run = fixture(tmp_path)
    if kind == "active":
        (target / "SingletonLock").touch()
    if kind == "schema":
        with contextlib.closing(sqlite3.connect(target / "Login Data")) as db:
            db.execute("ALTER TABLE logins ADD COLUMN opaque_secret BLOB")
            db.commit()
    if kind in ("metadata", "version", "trigger"):
        with contextlib.closing(sqlite3.connect(target / "Login Data")) as db:
            db.executescript(
                {
                    "metadata": "ALTER TABLE password_notes ADD COLUMN opaque_secret BLOB",
                    "version": "UPDATE meta SET value='999' WHERE key='version'",
                    "trigger": "CREATE TRIGGER unexpected AFTER INSERT ON logins BEGIN DELETE FROM password_notes; END",
                }[kind]
            )
            db.commit()
    if kind in ("wal", "journal"):
        (target / f"Login Data-{kind}").write_bytes(b"active journal")
    if kind.startswith("account"):
        (
            (source if kind == "account-source" else target) / "Login Data For Account"
        ).touch()
    if kind == "key":
        with contextlib.closing(sqlite3.connect(target / "Login Data")) as db:
            db.execute("UPDATE logins SET password_value=X'76313101'")
            db.commit()
    before = (target / "Login Data").read_bytes()
    with pytest.raises(ValueError, match="Password refresh refused"):
        run()
    assert (target / "Login Data").read_bytes() == before


def test_repeated_translated_password_writes_preserve_target(tmp_path):
    from browser_commander.browser.migration.firefox import write_chromium_passwords

    key = os.urandom(16)

    def write(password):
        return write_chromium_passwords(
            target_profile_dir=tmp_path,
            platform="linux",
            target_key=key,
            target_prefix="v11",
            entries=[
                {
                    "origin": "https://login.live.com",
                    "username": "local-user",
                    "password": password,
                }
            ],
        )

    assert write("first-secret")["migrated"] == 1
    before = (tmp_path / "Login Data").read_bytes()
    report = write("second-secret")
    assert report["migrated"] == 0
    assert report["skipped"][0]["reason"] == "target-existing"
    assert (tmp_path / "Login Data").read_bytes() == before


def test_empty_account_store_and_persistent_journal_are_preserved(tmp_path):
    source, target, _, run = fixture(tmp_path)
    account = target / "Login Data For Account"
    with contextlib.closing(sqlite3.connect(account)) as db:
        db.executescript(SCHEMA)
    before = account.read_bytes()
    (target / "Login Data-journal").write_bytes(bytes(512))
    assert run()["migrated"] == 1
    assert account.read_bytes() == before
    (source / "Login Data For Account").write_bytes(
        (source / "Login Data").read_bytes()
    )
    main_before = (target / "Login Data").read_bytes()
    with pytest.raises(ValueError, match="account-store-unsupported"):
        run()
    assert (target / "Login Data").read_bytes() == main_before
