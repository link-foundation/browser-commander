"""Generate finite, synthetic binarycookies fixtures shared by all languages.

Layout reference (no source code copied):
https://github.com/libyal/dtformats/blob/main/documentation/Safari%20Cookies.asciidoc
Run from the repository root: python experiments/issue-114/create-fixtures.py
"""

import json
import struct
from pathlib import Path

DESTINATION = Path("tests/fixtures/safari")
COOKIES = [
    dict(
        name="sid",
        value="fixture-token",
        domain=".github.com",
        path="/",
        expires=1900000000,
        secure=True,
        httpOnly=True,
        sameSite="Lax",
    ),
    dict(
        name="theme",
        value="café",
        domain="github.com",
        path="/settings",
        expires=1900000100,
        secure=False,
        httpOnly=False,
        sameSite="Lax",
    ),
    dict(
        name="other",
        value="synthetic-only",
        domain="other.test",
        path="/",
        expires=1900000200,
        secure=True,
        httpOnly=False,
        sameSite="Lax",
    ),
    dict(
        name="old",
        value="",
        domain="expired.test",
        path="/",
        expires=978307200,
        secure=False,
        httpOnly=True,
        sameSite="Lax",
    ),
]


def record(cookie):
    strings = [
        cookie[key].encode("utf-8") + b"\0"
        for key in ("domain", "name", "path", "value")
    ]
    offsets = []
    size = 56
    for string in strings:
        offsets.append(size)
        size += len(string)
    flags = int(cookie["secure"]) | (int(cookie["httpOnly"]) << 2)
    header = struct.pack(
        "<10I2d",
        size,
        0,
        flags,
        0,
        *offsets,
        0,
        0,
        cookie["expires"] - 978307200,
        700000000,
    )
    return header + b"".join(strings)


def page(cookies):
    if not cookies:
        # Empty pages may consist of just the signature and a zero count.
        return b"\x00\x00\x01\x00" + bytes(4)
    records = [record(cookie) for cookie in cookies]
    offsets = []
    size = 12 + 4 * len(records)
    for item in records:
        offsets.append(size)
        size += len(item)
    return (
        b"\x00\x00\x01\x00"
        + struct.pack("<I", len(records))
        + b"".join(struct.pack("<I", offset) for offset in offsets)
        + bytes(4)
        + b"".join(records)
    )


def main():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    pages = [page(COOKIES[:2]), page([]), page(COOKIES[2:])]
    data = (
        b"cook"
        + struct.pack(">I", len(pages))
        + b"".join(struct.pack(">I", len(item)) for item in pages)
        + b"".join(pages)
        + bytes(8)
    )
    (DESTINATION / "Cookies.binarycookies").write_bytes(data)
    (DESTINATION / "expected.json").write_text(
        json.dumps(COOKIES, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
