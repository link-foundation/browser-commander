import contextlib
import sqlite3

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
