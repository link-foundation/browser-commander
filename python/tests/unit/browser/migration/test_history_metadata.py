import contextlib
import sqlite3
from pathlib import Path

import pytest

from browser_commander.browser.migration.history import migrate_history


@pytest.mark.parametrize("domains", [["github.com"], []])
def test_history_metadata_is_omitted_or_preserved_with_domain_selection(
    tmp_path, domains
):
    source = tmp_path / "source"
    source.mkdir()
    filename = source / "History"
    with contextlib.closing(sqlite3.connect(filename)) as db:
        db.executescript(
            (
                Path(__file__).resolve().parents[5]
                / "tests/fixtures/history-opaque-metadata.sql"
            ).read_text(encoding="utf-8")
        )
        db.commit()
    before = filename.read_bytes()
    target = tmp_path / "target"
    report = migrate_history(
        source_profile_dir=source, target_profile_dir=target, domains=domains
    )
    assert report["migrated"] == 1
    with contextlib.closing(sqlite3.connect(target / "History")) as db:
        for table, unfiltered_count in (
            ("clusters", 2),
            ("clusters_and_visits", 3),
            ("cluster_keywords", 2),
            ("cluster_visit_duplicates", 2),
            ('future "history" metadata', 1),
        ):
            quoted = '"' + table.replace('"', '""') + '"'
            count = db.execute(f"SELECT count(*) FROM {quoted}").fetchone()[0]
            assert count == (0 if domains else unfiltered_count)
            assert any(
                entry["item"] == table
                and entry["reason"] == "unsupported-history-metadata"
                for entry in report["warnings"]
            ) == bool(domains)
        assert db.execute("SELECT count(*) FROM urls").fetchone()[0] == (
            1 if domains else 2
        )
        assert (
            db.execute("SELECT value FROM meta WHERE key='version'").fetchone()[0] == 70
        )
    assert (b"unrelated-history-marker" in (target / "History").read_bytes()) == (
        not domains
    )
    assert filename.read_bytes() == before
