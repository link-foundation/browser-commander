"""Writing a download into the managed directory (issue #88).

The rule the whole module exists to keep: a file that appears under its final
name is complete and has passed validation. Everything else lives under a
``.partial`` name and is removed.
"""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from browser_commander.downloads.destination import (
    ARTIFACT_DIRECTORY_MODE,
    ARTIFACT_FILE_MODE,
)
from browser_commander.downloads.naming import (
    renamed_candidate,
    resolve_inside_root,
    sanitize_download_name,
    with_extension,
)


class DownloadConflict:
    """How a name that is already taken is resolved."""

    #: Save alongside the existing file as ``name (2).pdf``.
    RENAME = "rename"
    #: Replace the existing file.
    OVERWRITE = "overwrite"
    #: Refuse to save.
    ERROR = "error"


#: How many bytes are kept to sniff a format from.
MAGIC_BYTES = 8

#: Highest rename attempt before giving up rather than looping forever.
MAX_RENAME_ATTEMPTS = 1000

#: How much is copied per read.
COPY_CHUNK_BYTES = 64 * 1024


@dataclass
class DownloadSource:
    """Where the bytes of one download can be read from."""

    path: str | None = None
    data: bytes | None = None
    #: Whether the source file is the engine's staging copy and may be removed.
    remove_source: bool = False


@dataclass
class SavedDownload:
    """What was written for one download."""

    path: str
    bytes: int
    checksum: str


@dataclass
class _Written:
    """Bookkeeping from copying a download into its partial file."""

    #: The first bytes of the file, kept for content sniffing. Declared before
    #: the ``bytes`` count so the field name does not shadow the builtin.
    head: bytes
    bytes: int
    checksum: str


def _chunks(source: DownloadSource) -> Any:
    """Open the download's bytes for reading.

    Args:
        source: Where to read from

    Returns:
        An iterator over byte chunks

    Raises:
        TypeError: When the source carries neither bytes nor a path
    """
    if source.data is not None:
        return iter([source.data])
    if source.path:
        return _read_file(source.path)
    msg = "a download source needs either data or a path"
    raise TypeError(msg)


def _read_file(path: str) -> Any:
    """Yield a file's contents in chunks.

    Args:
        path: File to read

    Yields:
        Byte chunks
    """
    with Path(path).open("rb") as handle:
        while True:
            chunk = handle.read(COPY_CHUNK_BYTES)
            if not chunk:
                return
            yield chunk


def _copy_to_partial(source: DownloadSource, partial_path: str) -> _Written:
    """Stream the download into a partial file, hashing it on the way through.

    Hashing during the copy means the bytes are read once: reading the file a
    second time to checksum it would double the I/O and leave a window where
    the file could change between the two reads.

    Args:
        source: Where to read from
        partial_path: Where the bytes are written

    Returns:
        What was written
    """
    digest = hashlib.sha256()
    total = 0
    head = b""

    descriptor = os.open(
        partial_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, ARTIFACT_FILE_MODE
    )
    with os.fdopen(descriptor, "wb") as target:
        for chunk in _chunks(source):
            digest.update(chunk)
            total += len(chunk)
            if len(head) < MAGIC_BYTES:
                head = (head + chunk)[:MAGIC_BYTES]
            target.write(chunk)

    return _Written(bytes=total, checksum=digest.hexdigest(), head=head)


async def _call(callback: Callable[..., Any], **kwargs: Any) -> Any:
    """Call a caller-supplied callback that may be sync or async.

    Args:
        callback: The callback
        **kwargs: Arguments to pass

    Returns:
        The callback's result
    """
    result = callback(**kwargs)
    if inspect.isawaitable(result):
        return await result
    return result


def resolve_final_path(
    *,
    root: str,
    name: str,
    conflict: str,
) -> str:
    """Choose the final path for a completed download.

    Args:
        root: Absolute download directory
        name: Sanitized file name
        conflict: Conflict policy

    Returns:
        Absolute final path

    Raises:
        FileExistsError: When the name is taken and the policy says to fail
        RuntimeError: When no free name could be found
    """
    if conflict == DownloadConflict.OVERWRITE:
        return resolve_inside_root(root, name)

    for attempt in range(MAX_RENAME_ATTEMPTS):
        candidate = resolve_inside_root(root, renamed_candidate(name, attempt))
        if not Path(candidate).exists():
            return candidate
        if conflict == DownloadConflict.ERROR:
            msg = f"refusing to replace {candidate}: downloads conflict is 'error'"
            raise FileExistsError(msg)

    msg = (
        f'could not find a free name for "{name}" after {MAX_RENAME_ATTEMPTS} attempts'
    )
    raise RuntimeError(msg)


async def save_download(
    *,
    root: str,
    source: DownloadSource,
    suggested_filename: str,
    mime_type: str | None = None,
    conflict: str = DownloadConflict.RENAME,
    filename: Callable[..., Any] | None = None,
    validate: Callable[..., Any] | None = None,
) -> SavedDownload:
    """Save a download into the managed directory.

    Args:
        root: Absolute download directory
        source: Where to read the bytes from
        suggested_filename: Name the page suggested
        mime_type: MIME type declared by the server
        conflict: Conflict policy
        filename: Caller naming callback
        validate: Validation run before the file is published

    Returns:
        What was saved

    Raises:
        ValueError: When validation rejected the download
    """
    Path(root).mkdir(parents=True, exist_ok=True, mode=ARTIFACT_DIRECTORY_MODE)

    # A caller callback runs *before* sanitization, never instead of it: it is
    # a naming preference, not a grant of write access outside the root.
    chosen = (
        await _call(
            filename, suggested_filename=suggested_filename, mime_type=mime_type
        )
        if filename
        else suggested_filename
    )
    safe_name = sanitize_download_name(
        chosen if chosen is not None else suggested_filename
    )

    partial_path = resolve_inside_root(
        root,
        f"{safe_name}.{os.getpid()}.{time.time_ns()}.partial",
    )

    try:
        written = await asyncio.to_thread(_copy_to_partial, source, partial_path)

        if validate:
            # Validation sees the partial file, so a rejected download never
            # exists under the name a caller would pick it up by.
            verdict = await _call(
                validate,
                path=partial_path,
                bytes=written.bytes,
                checksum=written.checksum,
                mime_type=mime_type,
                suggested_filename=suggested_filename,
            )
            if verdict is False:
                msg = f'"{safe_name}" was rejected by the caller\'s validation'
                raise ValueError(msg)
    except BaseException:
        Path(partial_path).unlink(missing_ok=True)
        raise

    final_name = with_extension(safe_name, mime_type=mime_type, head=written.head)

    try:
        final_path = resolve_final_path(root=root, name=final_name, conflict=conflict)
        # Rename rather than copy: within one filesystem it is atomic, so a
        # reader watching the directory never sees a half-written file under
        # this name.
        Path(partial_path).replace(final_path)
        Path(final_path).chmod(ARTIFACT_FILE_MODE)
    except BaseException:
        Path(partial_path).unlink(missing_ok=True)
        raise

    return SavedDownload(
        path=final_path, bytes=written.bytes, checksum=written.checksum
    )


def clean_partials(root: str | os.PathLike[str]) -> list[str]:
    """Remove every partial file left behind in a download directory.

    Args:
        root: Absolute download directory

    Returns:
        Paths that were removed
    """
    try:
        entries = sorted(Path(root).iterdir())
    except OSError:
        return []

    removed = []
    for entry in entries:
        if entry.name.endswith(".partial"):
            entry.unlink(missing_ok=True)
            removed.append(str(entry))
    return removed
