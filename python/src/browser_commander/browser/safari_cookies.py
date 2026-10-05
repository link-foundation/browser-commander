"""Decode Safari's unencrypted mixed-endian Cookies.binarycookies format.

Layout: https://github.com/libyal/dtformats/blob/main/documentation/Safari%20Cookies.asciidoc
SameSite is absent from the format; migrations report the Lax fallback.
"""

from __future__ import annotations

import math
import os
import struct
import sys
from collections.abc import Iterator, Mapping, Sequence
from pathlib import Path

APPLE_EPOCH = 978_307_200


def _invalid(detail: str) -> ValueError:
    return ValueError(f"Invalid Safari binarycookies: {detail}")


def _bounded(data: memoryview, offset: int, size: int) -> memoryview:
    if offset < 0 or size < 0 or offset + size > len(data):
        raise _invalid("truncated or out-of-range data")
    return data[offset : offset + size]


def _uint(data: memoryview, offset: int, big_endian: bool = False) -> int:
    return struct.unpack(">I" if big_endian else "<I", _bounded(data, offset, 4))[0]


def _string(record: memoryview, field: int) -> str:
    offset = _uint(record, field)
    if not 56 <= offset < len(record):
        raise _invalid("string offset")
    tail = bytes(record[offset:])
    end = tail.find(b"\0")
    if end < 0:
        raise _invalid("unterminated string")
    try:
        return tail[:end].decode("utf-8")
    except UnicodeDecodeError as error:
        raise _invalid("invalid UTF-8") from error


def _records(data: bytes) -> Iterator[memoryview]:
    view = memoryview(data)
    if bytes(_bounded(view, 0, 4)) != b"cook":
        raise _invalid("file signature")
    pages = _uint(view, 4, True)
    _bounded(view, 8, pages * 4)
    page_start = 8 + pages * 4
    for index in range(pages):
        page = _bounded(view, page_start, _uint(view, 8 + index * 4, True))
        page_start += len(page)
        if _uint(page, 0) != 0x00010000:
            raise _invalid("page signature")
        count = _uint(page, 4)
        header_size = 8 + count * 4
        _bounded(page, 0, header_size)
        previous_end = header_size
        for cookie in range(count):
            start = _uint(page, 8 + cookie * 4)
            if start < previous_end:
                raise _invalid("overlapping record")
            size = _uint(page, start)
            if size < 56:
                raise _invalid("short record")
            record = _bounded(page, start, size)
            previous_end = start + size
            yield record
    # The optional checksum/plist trailer is not cookie data.


def parse_safari_cookies(data: bytes, domain_filter: str | None = None) -> list[dict]:
    cookies = []
    for record in _records(data):
        domain = _string(record, 16)
        if domain_filter and domain_filter.lower() not in domain.lower():
            continue
        expiry = struct.unpack("<d", record[40:48])[0] + APPLE_EPOCH
        if not math.isfinite(expiry) or abs(expiry) > 2**53 - 1:
            raise _invalid("expiry")
        flags = _uint(record, 8)
        cookies.append(
            {
                "name": _string(record, 20),
                "value": _string(record, 28),
                "domain": domain,
                "path": _string(record, 24) or "/",
                "expires": math.floor(expiry),
                "httpOnly": bool(flags & 4),
                "secure": bool(flags & 1),
                "sameSite": "Lax",
            }
        )
    return cookies


def count_safari_cookies(
    data: bytes, domains: Sequence[str] | None = None
) -> tuple[int, dict[str, int] | None]:
    """Decode domain strings only; never decode cookie names or values."""
    by_domain = dict.fromkeys(domains, 0) if domains else None
    total = 0
    for record in _records(data):
        host = _string(record, 16).lower()
        total += 1
        if by_domain is not None:
            for domain in by_domain:
                if domain.lower() in host:
                    by_domain[domain] += 1
    return total, by_domain


def find_safari_cookie_file(profile_dir: Path) -> Path | None:
    for candidate in (
        profile_dir / "Cookies/Cookies.binarycookies",
        profile_dir / "Cookies.binarycookies",
    ):
        try:
            if candidate.stat().st_mode & 0o170000 == 0o100000:
                return candidate
        except PermissionError:
            # Preserve protected profiles so reads/listings explain Full Disk Access.
            return candidate
        except (FileNotFoundError, NotADirectoryError):
            continue
    return None


def read_safari_cookie_file(
    file_path: Path, *, environment: Mapping[str, str] | None = None
) -> bytes:
    try:
        return file_path.read_bytes()
    except PermissionError as error:
        env = os.environ if environment is None else environment
        app = (
            env.get("__CFBundleIdentifier") or env.get("TERM_PROGRAM") or sys.executable
        )
        raise PermissionError(
            error.errno,
            f"Safari cookie access denied at {file_path}. Grant Full Disk Access to {app}, the app running Browser Commander, then retry: x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
        ) from error
