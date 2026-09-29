"""Consistent read-only snapshots of a live browser's SQLite databases.

A running browser keeps ``History``, ``Login Data``, ``places.sqlite`` and
friends open (often in WAL mode), so copying the main file alone can yield a
torn or stale database. The snapshot opens the source strictly read-only
through a ``file:...?mode=ro`` URI and copies it with SQLite's online backup
API (:meth:`sqlite3.Connection.backup`), which produces a transactionally
consistent copy without ever writing to the source. When the source cannot be
opened or backed up (an exclusive lock held by the browser, for example) the
main file and its ``-wal``/``-shm``/``-journal`` sidecars are copied instead.

The snapshot lives in a private temporary directory that is always removed
after the reader returns.
"""

from __future__ import annotations

import contextlib
import shutil
import sqlite3
import tempfile
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

_SQLITE_SIDECARS = ("-wal", "-shm", "-journal")


def _read_only_uri(path: Path) -> str:
    return f"{path.resolve().as_uri()}?mode=ro"


def _backup(source_path: Path, snapshot_path: Path) -> None:
    source = sqlite3.connect(_read_only_uri(source_path), uri=True)
    try:
        with contextlib.closing(sqlite3.connect(snapshot_path)) as destination:
            source.backup(destination)
    finally:
        source.close()


def _copy_database_files(source_path: Path, snapshot_path: Path) -> None:
    for suffix in ("", *_SQLITE_SIDECARS):
        with contextlib.suppress(FileNotFoundError):
            snapshot_path.with_name(f"{snapshot_path.name}{suffix}").unlink()
    shutil.copyfile(source_path, snapshot_path)
    for suffix in _SQLITE_SIDECARS:
        sidecar = source_path.with_name(f"{source_path.name}{suffix}")
        if sidecar.exists():
            shutil.copyfile(
                sidecar, snapshot_path.with_name(f"{snapshot_path.name}{suffix}")
            )


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
        except sqlite3.Error:
            _copy_database_files(source, snapshot_path)
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
