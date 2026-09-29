"""Tests for Chromium history migration (mirrors history.test.js)."""

from __future__ import annotations

import contextlib
import sqlite3
from typing import TYPE_CHECKING

from browser_commander.browser.migration.history import migrate_history
from tests.helpers.migration_fixtures import (
    assert_nothing_migrated,
    assert_source_unchanged,
    migrate_between,
    write_chromium_history,
)

if TYPE_CHECKING:
    from pathlib import Path


class TestMigrateHistory:
    def test_snapshots_history_into_the_target_and_reports_the_url_count(
        self, tmp_path: Path
    ) -> None:
        source = tmp_path / "source"
        target = tmp_path / "target"
        source.mkdir()
        write_chromium_history(source, 5)

        report = migrate_between(migrate_history, source, target)

        assert report["migrated"] == 1
        assert (target / "History").is_file()
        warning = next(
            entry
            for entry in report["warnings"]
            if entry["reason"] == "snapshot-copied"
        )
        assert "5 history URLs" in warning["detail"]
        with contextlib.closing(sqlite3.connect(target / "History")) as database:
            assert database.execute("SELECT COUNT(*) FROM urls").fetchone()[0] == 5

    def test_copies_top_sites_when_present(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        target = tmp_path / "target"
        source.mkdir()
        write_chromium_history(source, 1)
        with contextlib.closing(sqlite3.connect(source / "Top Sites")) as database:
            database.execute("CREATE TABLE top_sites (url TEXT)")
            database.commit()

        report = migrate_between(migrate_history, source, target)

        assert report["migrated"] == 1
        assert (target / "Top Sites").is_file()

    def test_never_writes_to_the_source_database(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        source.mkdir()
        history_path = write_chromium_history(source, 2)

        assert_source_unchanged(
            history_path,
            lambda: migrate_between(migrate_history, source, tmp_path / "target"),
        )

    def test_reports_a_skip_when_there_is_no_history_database(
        self, tmp_path: Path
    ) -> None:
        source = tmp_path / "source"
        source.mkdir()
        report = migrate_between(migrate_history, source, tmp_path / "target")
        assert_nothing_migrated(report, "source-missing")
