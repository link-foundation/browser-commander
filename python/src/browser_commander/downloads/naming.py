"""Naming and placement rules for managed downloads (issue #88).

Everything here answers one question: given a name a *page* chose, where is it
safe to write the bytes? A suggested filename is attacker-controlled input, so
it is treated as a hint and never as a path.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

#: The type a server sends when it cannot name the format either.
GENERIC_BINARY_TYPE = "application/octet-stream"

#: Extensions derived from a declared or detected MIME type.
MIME_EXTENSIONS: dict[str, str] = {
    "application/pdf": ".pdf",
    "application/json": ".json",
    "application/zip": ".zip",
    "application/gzip": ".gz",
    "application/x-tar": ".tar",
    GENERIC_BINARY_TYPE: ".bin",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "text/csv": ".csv",
    "text/html": ".html",
    "text/plain": ".txt",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
}

#: Leading bytes that identify a format regardless of what the page claimed.
MAGIC_NUMBERS: tuple[tuple[str, bytes], ...] = (
    (".pdf", b"%PDF"),
    (".png", b"\x89PNG"),
    (".gif", b"GIF8"),
    (".jpg", b"\xff\xd8\xff"),
    (".zip", b"PK\x03\x04"),
    (".gz", b"\x1f\x8b"),
)

#: Name used when a page suggests nothing usable at all.
FALLBACK_NAME = "download"

#: Windows device names that cannot be used as files even on other systems.
RESERVED_NAMES = frozenset(
    ["con", "prn", "aux", "nul"]
    + [f"com{index}" for index in range(1, 10)]
    + [f"lpt{index}" for index in range(1, 10)]
)

_CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")
_ILLEGAL_CHARACTERS = re.compile(r'[:*?"<>|]')
_ONLY_DOTS = re.compile(r"^\.+$")


def _trim_name_edges(value: str) -> str:
    r"""Trim leading whitespace, and trailing whitespace or dots.

    ``re.sub(r"^\s+|[\s.]+$", "", value)`` says the same thing in one line, but
    it backtracks quadratically over a long run of whitespace, and this string
    was chosen by the page. Walking in from both ends is one pass and cannot be
    made to cost more. Leading dots survive on purpose: ``.bashrc`` is a name,
    not padding.

    Args:
        value: Name to trim

    Returns:
        The name without its padding
    """
    start = 0
    end = len(value)

    while start < end and value[start].isspace():
        start += 1
    while end > start and (value[end - 1] == "." or value[end - 1].isspace()):
        end -= 1

    return value[start:end]


def sanitize_download_name(suggested: object) -> str:
    """Strip a page-supplied name down to a single safe segment.

    Path separators, drive letters, control characters and ``..`` segments are
    removed rather than rejected, because a rejected download is a lost
    download and the caller asked for the file, not for the page's spelling of
    it.

    Args:
        suggested: Name suggested by the page or engine

    Returns:
        A single safe path segment
    """
    raw = suggested if isinstance(suggested, str) else ""

    # Take the last segment under both separators: a page may suggest
    # ``../../etc/passwd`` or ``C:\\Windows\\system32\\x``, and neither is a
    # location we are willing to honor.
    last_segment = re.split(r"[/\\]", raw)[-1]

    cleaned = _CONTROL_CHARACTERS.sub("", last_segment)
    cleaned = _ILLEGAL_CHARACTERS.sub("_", cleaned)
    cleaned = _trim_name_edges(cleaned)

    if not cleaned or _ONLY_DOTS.match(cleaned):
        return FALLBACK_NAME

    dot = cleaned.rfind(".")
    stem = cleaned[:dot] if dot > 0 else cleaned
    if stem.lower() in RESERVED_NAMES:
        return f"_{cleaned}"

    return cleaned


def extension_from_content(head: bytes | bytearray | None) -> str:
    """Guess an extension from the first bytes of the file.

    Args:
        head: Leading bytes of the download

    Returns:
        Extension including the dot, or an empty string
    """
    if not head:
        return ""

    probe = bytes(head)
    for extension, magic in MAGIC_NUMBERS:
        if probe.startswith(magic):
            return extension
    return ""


def declared_extension(name: str) -> str:
    """Return a file name's trailing extension, including the dot.

    A leading dot names a hidden file rather than an extension, so ``.env``
    has none. The rule matches Node's ``path.extname`` so the JavaScript and
    Python managers name the same download identically.

    Args:
        name: File name to inspect

    Returns:
        The extension with its dot, or an empty string
    """
    dot = name.rfind(".")
    return name[dot:] if dot > 0 else ""


def with_extension(
    name: str,
    *,
    mime_type: str | None = None,
    head: bytes | bytearray | None = None,
) -> str:
    """Give a name an extension when the page did not supply one.

    Pages hand out UUID-like names constantly; a file called ``7f1c...-9ab2``
    is unusable to a human and unopenable by the OS, so the declared MIME type
    (or the bytes themselves) supplies the missing suffix.

    Args:
        name: Sanitized name
        mime_type: MIME type declared by the server
        head: Leading bytes of the file

    Returns:
        Name with an extension when one could be determined
    """
    if declared_extension(name):
        return name

    declared_type = str(mime_type or "").split(";")[0].strip().lower()
    declared = MIME_EXTENSIONS.get(declared_type)
    sniffed = extension_from_content(head)
    # ``application/octet-stream`` is what a server sends when it does not know
    # either, so the bytes outrank it; any other declared type is a real claim.
    extension = (
        (sniffed or declared)
        if declared_type == GENERIC_BINARY_TYPE
        else (declared or sniffed)
    )
    return f"{name}{extension}" if extension else name


def is_inside_root(
    root: str | os.PathLike[str], candidate: str | os.PathLike[str]
) -> bool:
    """Report whether a resolved path stays inside the download root.

    The check is done on resolved paths rather than on the name, so a symlinked
    or relative root cannot be used to step outside it.

    Args:
        root: Download directory
        candidate: Candidate path

    Returns:
        Whether the candidate is inside the root
    """
    resolved_root = Path(root).resolve()
    resolved_candidate = Path(candidate).resolve()
    if resolved_candidate == resolved_root:
        return False
    try:
        resolved_candidate.relative_to(resolved_root)
    except ValueError:
        return False
    return True


def resolve_inside_root(root: str | os.PathLike[str], name: str) -> str:
    """Resolve a safe absolute path for a download inside the root.

    Args:
        root: Download directory
        name: Sanitized file name

    Returns:
        Absolute path inside the root

    Raises:
        ValueError: When the name would escape the root
    """
    candidate = Path(root) / name
    if not is_inside_root(root, candidate):
        msg = f'refusing to write "{name}" outside the download directory {root}'
        raise ValueError(msg)
    return str(Path(candidate).resolve())


def renamed_candidate(name: str, attempt: int) -> str:
    """Produce the candidate names a rename-on-conflict policy tries, in order.

    ``report.pdf``, ``report (2).pdf``, ``report (3).pdf``, ... - the order is
    fixed, so two runs of the same scenario produce the same names.

    Args:
        name: Sanitized file name
        attempt: Zero-based attempt number

    Returns:
        Candidate name for that attempt
    """
    if attempt == 0:
        return name

    extension = declared_extension(name)
    stem = name[: -len(extension)] if extension else name
    return f"{stem} ({attempt + 1}){extension}"
