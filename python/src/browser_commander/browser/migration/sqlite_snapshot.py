"""Consistent read-only snapshots of a live browser's SQLite databases.

A running browser keeps ``History``, ``Login Data``, ``places.sqlite`` and
friends open (often in WAL mode), so copying the main file alone can yield a
torn or stale database. The snapshot opens the source strictly read-only
through a ``file:...?mode=ro`` URI and copies it with SQLite's online backup
API (:meth:`sqlite3.Connection.backup`), which produces a transactionally
consistent copy without ever writing to the source. When a lock prevents backup,
report snapshot guidance: separately copying live files cannot ensure consistency.

The snapshot lives in a private temporary directory that is always removed
after the reader returns.
"""

from __future__ import annotations

import contextlib
import shutil
import sqlite3
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

from browser_commander.browser.migration.fs_utils import PathLike

__all__ = [
    "SNAPSHOT_PREFIX",
    "read_database_snapshot",
    "with_database_snapshot",
]

T = TypeVar("T")

#: Prefix of the temporary directory that holds a snapshot.
SNAPSHOT_PREFIX = "browser-commander-snap-"

# SQLite result codes; Python 3.9/3.10 do not export the named constants.
_SQLITE_BUSY, _SQLITE_LOCKED = 5, 6


def _read_only_uri(path: Path) -> str:
    return f"{path.resolve().as_uri()}?mode=ro"


def _backup(source_path: Path, snapshot_path: Path) -> None:
    last_progress = time.monotonic()

    def progress(status: int, remaining: int, total: int) -> None:
        nonlocal last_progress
        if status in (_SQLITE_BUSY, _SQLITE_LOCKED):
            if time.monotonic() - last_progress >= 1:
                raise sqlite3.OperationalError("live SQLite backup remained busy")
        else:
            last_progress = time.monotonic()

    source = sqlite3.connect(_read_only_uri(source_path), uri=True, timeout=0)
    try:
        with contextlib.closing(sqlite3.connect(snapshot_path)) as destination:
            source.backup(destination, pages=256, progress=progress, sleep=0.05)
    finally:
        source.close()


def with_database_snapshot(source_path: PathLike, read: Callable[[Path], T]) -> T:
    """Snapshot ``source_path`` and call ``read(snapshot_path)``.

    Args:
        source_path: The live database to snapshot. It is never written to.
        read: Receives the path of the snapshot; its return value is returned.

    Raises:
        FileNotFoundError: When ``source_path`` does not exist.
    """

    source = Path(source_path)
    if not source.exists():
        msg = f"Source database does not exist: {source_path}"
        raise FileNotFoundError(msg)
    directory = Path(tempfile.mkdtemp(prefix=SNAPSHOT_PREFIX))
    snapshot_path = directory / source.name
    try:
        try:
            _backup(source, snapshot_path)
        except sqlite3.Error as error:
            message = (
                f"Consistent SQLite snapshot unavailable for {source}; "
                "close the source browser and retry, or supply a consistent "
                f"read-only snapshot. {error}"
            )
            raise sqlite3.OperationalError(message) from error
        return read(snapshot_path)
    finally:
        shutil.rmtree(directory, ignore_errors=True)


def read_database_snapshot(
    source_path: PathLike, read: Callable[[sqlite3.Connection], T]
) -> T:
    """Snapshot ``source_path`` and call ``read(connection)``.

    The connection is opened read-only on the snapshot, uses
    :class:`sqlite3.Row` rows and is closed after ``read`` returns.
    """

    def read_snapshot(snapshot_path: Path) -> T:
        connection = sqlite3.connect(_read_only_uri(snapshot_path), uri=True)
        connection.row_factory = sqlite3.Row
        try:
            return read(connection)
        finally:
            connection.close()

    return with_database_snapshot(source_path, read_snapshot)
