"""Read Safari plists, history and explicitly supplied Passwords exports."""

from __future__ import annotations

import csv
import os
import plistlib
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, TypeVar

from browser_commander.browser.migration.domains import matches_domains
from browser_commander.browser.migration.fs_utils import PathLike
from browser_commander.browser.migration.sqlite_snapshot import read_database_snapshot

T = TypeVar("T")


def with_safari_access(filename: PathLike, read: Callable[[], T]) -> T:
    """Name the executing app and retry path for every protected Safari file."""
    try:
        return read()
    except PermissionError as error:
        app = (
            os.environ.get("__CFBundleIdentifier")  # noqa: SIM112
            or os.environ.get("TERM_PROGRAM")
            or Path(sys.executable).name
        )
        raise PermissionError(
            error.errno,
            f"Safari access denied at {filename}. Grant Full Disk Access to {app}, "
            "the app running Browser Commander, then retry: "
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
            str(filename),
        ) from error


def read_safari_plist(filename: PathLike) -> Any:
    """plistlib auto-detects binary and XML without mutating the source."""
    return with_safari_access(
        filename, lambda: plistlib.loads(Path(filename).read_bytes())
    )


def read_safari_bookmarks(filename: PathLike) -> list[dict[str, Any]]:
    document = read_safari_plist(filename)

    def convert(
        node: dict[str, Any], reading_list: bool = False
    ) -> dict[str, Any] | None:
        reading_list = (
            reading_list
            or node.get("Title") == "com.apple.ReadingList"
            or bool(node.get("ReadingList"))
        )
        if node.get("WebBookmarkType") == "WebBookmarkTypeLeaf":
            if not node.get("URLString"):
                return None
            return {
                "type": "url",
                "name": node.get("URIDictionary", {}).get("title")
                or node.get("Title")
                or node["URLString"],
                "url": node["URLString"],
                "readingList": reading_list,
            }
        return {
            "type": "folder",
            "name": "Reading List" if reading_list else node.get("Title", ""),
            "children": [
                entry
                for child in node.get("Children", [])
                if (entry := convert(child, reading_list)) is not None
            ],
        }

    return [
        entry
        for node in document.get("Children", [])
        if (entry := convert(node)) is not None
    ]


def read_safari_history(
    filename: PathLike, domains: Sequence[str] | None = None
) -> list[dict[str, Any]]:
    def read() -> list[dict[str, Any]]:
        with Path(filename).open("rb"):
            pass
        return read_database_snapshot(
            filename,
            lambda db: [
                {
                    "url": row["url"],
                    "title": row["title"] or "",
                    "time": round((row["visit_time"] + 978307200) * 1000000),
                }
                for row in db.execute(
                    "SELECT i.url,v.title,v.visit_time FROM history_items i "
                    "JOIN history_visits v ON i.id=v.history_item ORDER BY v.visit_time,v.id"
                )
                if matches_domains(row["url"], domains)
            ],
        )

    return with_safari_access(filename, read)


def read_safari_passwords(
    filename: PathLike, domains: Sequence[str] | None = None
) -> list[dict[str, str]]:
    with Path(filename).open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not {"URL", "Username", "Password"}.issubset(reader.fieldnames or []):
            raise ValueError(
                "Safari password CSV must have URL, Username and Password columns"
            )
        entries = []
        for row in reader:
            # DictReader silently pads short records with None and stores extra
            # fields under a None key, unlike the native JS/Rust CSV readers.
            if None in row or any(value is None for value in row.values()):
                raise ValueError(
                    f"Safari password CSV record at line {reader.line_num} "
                    "does not match its header columns"
                )
            if row["URL"] and matches_domains(row["URL"], domains):
                entries.append(
                    {
                        "origin": row["URL"],
                        "username": row["Username"],
                        "password": row["Password"],
                    }
                )
        return entries
