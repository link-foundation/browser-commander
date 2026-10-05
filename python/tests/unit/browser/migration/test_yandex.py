import contextlib
import os
import sqlite3

from browser_commander.browser.browser_cookie_crypto import decrypt_chromium_cookie
from browser_commander.browser.migration.chromium_crypto import encrypt_chromium_value
from browser_commander.browser.migration.profile import migrate_profile_sync


def test_yandex_passman_has_specific_reason_before_key_lookup(tmp_path):
    source = tmp_path / "source"
    profile = source / "Default"
    profile.mkdir(parents=True)
    with contextlib.closing(sqlite3.connect(profile / "Ya Passman Data")) as db:
        db.executescript(
            "CREATE TABLE meta(key TEXT,value BLOB); INSERT INTO meta VALUES('local_encryptor_data',x'01')"
        )
    report = migrate_profile_sync(
        from_={"browser": "yandex", "user_data_dir": source},
        to=tmp_path / "target",
        include=["passwords"],
    )
    assert report["migrated"]["passwords"] == 0
    assert report["skipped"][0]["reason"] == "yandex-passman-encryption-unsupported"
    assert "master password" in report["skipped"][0]["detail"]


def test_yandex_keeps_supported_logins_beside_unsupported_passman(tmp_path):
    source = tmp_path / "source"
    profile = source / "Default"
    profile.mkdir(parents=True)
    passman = profile / "Ya Passman Data"
    passman.write_bytes(b"unsupported-store")
    source_key, target_key = os.urandom(16), os.urandom(16)
    login_data = profile / "Login Data"
    with contextlib.closing(sqlite3.connect(login_data)) as db:
        db.execute(
            "CREATE TABLE logins(origin_url TEXT,username_value TEXT,password_value BLOB)"
        )
        db.execute(
            "INSERT INTO logins VALUES(?,?,?)",
            (
                "https://example.com",
                "alice",
                encrypt_chromium_value(
                    "retained-password", key=source_key, platform="linux", prefix="v11"
                ),
            ),
        )
        db.commit()
    original = login_data.read_bytes()
    target = tmp_path / "target"
    report = migrate_profile_sync(
        from_={"browser": "yandex", "user_data_dir": source},
        to=target,
        include=["passwords"],
        platform="linux",
        keys={"target_key": target_key, "resolve_source_key": lambda _: source_key},
    )
    assert report["migrated"]["passwords"] == 1
    assert report["skipped"][0]["reason"] == "yandex-passman-encryption-unsupported"
    with contextlib.closing(sqlite3.connect(target / "Login Data")) as db:
        encrypted = db.execute("SELECT password_value FROM logins").fetchone()[0]
    assert (
        decrypt_chromium_cookie(
            encrypted, host="", database_version=0, platform="linux", key=target_key
        )
        == "retained-password"
    )
    assert login_data.read_bytes() == original
    assert passman.read_bytes() == b"unsupported-store"
