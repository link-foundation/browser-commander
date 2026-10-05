"""Live SQLite backup failures must not become unverified file copies."""

import contextlib
import sqlite3
import time
from pathlib import Path
from threading import Timer

import pytest

from browser_commander.browser.migration.sqlite_snapshot import read_database_snapshot


def test_exclusive_lock_reports_snapshot_guidance_without_waiting(
    tmp_path: Path,
) -> None:
    source = tmp_path / "History"
    with contextlib.closing(sqlite3.connect(source, check_same_thread=False)) as writer:
        writer.execute("create table visits(url text)")
        writer.execute("insert into visits values ('committed')")
        writer.commit()
        writer.execute("begin exclusive")
        # Bound the reproduction even before the fix: release the lock after
        # four seconds, so a regression cannot strand the test process.
        release = Timer(4, writer.rollback)
        release.start()
        try:
            started = time.monotonic()
            with pytest.raises(
                sqlite3.OperationalError,
                match=r"Consistent SQLite snapshot unavailable.*close the source browser",
            ):
                read_database_snapshot(
                    source, lambda db: db.execute("select url from visits").fetchall()
                )
            elapsed = time.monotonic() - started
            assert elapsed < 3, f"backup waited {elapsed:.2f}s for the source writer"
        finally:
            release.cancel()
            release.join()
            writer.rollback()


def test_snapshot_includes_committed_wal_with_open_writer(tmp_path: Path) -> None:
    source = tmp_path / "History"
    with contextlib.closing(sqlite3.connect(source)) as writer:
        writer.execute("pragma journal_mode=WAL")
        writer.execute("create table visits(url text)")
        writer.execute("insert into visits values ('committed WAL value')")
        writer.commit()
        rows = read_database_snapshot(
            source,
            lambda database: database.execute("select url from visits").fetchall(),
        )
        assert [row[0] for row in rows] == ["committed WAL value"]
