"""Live SQLite backups must fall back instead of waiting forever on locks."""

import contextlib
import sqlite3
import time
from pathlib import Path
from threading import Timer

from browser_commander.browser.migration.sqlite_snapshot import read_database_snapshot


def test_exclusive_lock_falls_back_without_waiting_for_writer(tmp_path: Path) -> None:
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
            rows = read_database_snapshot(
                source, lambda db: db.execute("select url from visits").fetchall()
            )
            elapsed = time.monotonic() - started
            assert [row[0] for row in rows] == ["committed"]
            assert elapsed < 3, f"backup waited {elapsed:.2f}s for the source writer"
        finally:
            release.cancel()
            release.join()
            writer.rollback()
