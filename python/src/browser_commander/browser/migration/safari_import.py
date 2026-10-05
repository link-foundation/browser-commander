"""Translate supported Safari classes into Chromium target files."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from browser_commander.browser.migration.chromium_writers import (
    write_chromium_bookmarks,
    write_chromium_history,
)
from browser_commander.browser.migration.firefox import write_chromium_passwords
from browser_commander.browser.migration.safari import (
    read_safari_bookmarks,
    read_safari_history,
    read_safari_passwords,
    with_safari_access,
)


def _find_store(profile_dir: Path, name: str, legacy_dir: Path | None) -> Path | None:
    for candidate in [
        profile_dir / "Safari" / name,
        profile_dir / name,
        *([legacy_dir / name] if legacy_dir else []),
    ]:
        try:
            with_safari_access(candidate, candidate.stat)
            return candidate
        except FileNotFoundError:
            pass
    return None


def migrate_safari_class(
    *,
    type_: str,
    profile_dir: Path,
    target_profile_dir: Path,
    domains: Sequence[str] | None,
    password_csv: str | Path | None,
    password_keys: Mapping[str, Any] | None,
    platform: str,
    legacy_dir: Path | None,
) -> dict[str, Any]:
    def skipped(reason: str, detail: str | None = None) -> dict[str, Any]:
        return {
            "migrated": 0,
            "skipped": [
                {
                    "type": type_,
                    "item": str(profile_dir),
                    "reason": reason,
                    **({"detail": detail} if detail else {}),
                }
            ],
            "warnings": [],
        }

    if type_ in ("preferences", "extensions"):
        return skipped(
            "safari-class-not-supported",
            "Safari preferences and extensions do not use Chromium formats.",
        )
    if type_ == "passwords":
        if not password_csv:
            return skipped(
                "safari-password-export-required",
                "Export Passwords from Safari or the Passwords app to CSV, then supply password_csv (CLI: --password-csv).",
            )
        entries = read_safari_passwords(password_csv, domains)
        if not password_keys or not password_keys.get("target_key"):
            return skipped(
                "target-key-unavailable",
                "Supply the dedicated target profile encryption key; no plaintext passwords are written.",
            )
        migrated = write_chromium_passwords(
            entries=entries,
            target_profile_dir=target_profile_dir,
            platform=platform,
            target_key=password_keys["target_key"],
            target_prefix=password_keys.get("target_prefix"),
        )
        return {"migrated": migrated, "skipped": [], "warnings": []}
    filename = _find_store(
        profile_dir,
        "Bookmarks.plist" if type_ == "bookmarks" else "History.db",
        legacy_dir,
    )
    if filename is None:
        return skipped("source-missing")
    if type_ == "bookmarks":
        entries = read_safari_bookmarks(filename)

        def has_reading_list(nodes: Sequence[dict[str, Any]]) -> bool:
            return any(
                node.get("readingList") or has_reading_list(node.get("children", []))
                for node in nodes
            )

        migrated = write_chromium_bookmarks(target_profile_dir, entries)
        warnings = (
            [
                {
                    "type": type_,
                    "item": str(filename),
                    "reason": "safari-reading-list-translated",
                    "detail": "Reading-list URLs become bookmarks; read status and preview metadata are not translated.",
                }
            ]
            if has_reading_list(entries)
            else []
        )
        return {"migrated": migrated, "skipped": [], "warnings": warnings}
    migrated = write_chromium_history(
        target_profile_dir, read_safari_history(filename, domains)
    )
    return {"migrated": migrated, "skipped": [], "warnings": []}
