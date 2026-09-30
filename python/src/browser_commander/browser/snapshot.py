"""Read-only live Chromium profile snapshots and native snapshot launches."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import shutil
import sqlite3
import stat
import tempfile
from dataclasses import dataclass, replace
from pathlib import Path
from typing import TYPE_CHECKING, Any

from browser_commander.browser.browser_profiles import (
    browser_profile_root,
    normalize_cookie_browser,
)
from browser_commander.browser.migration.sqlite_snapshot import with_database_snapshot
from browser_commander.browser.profile_directory import (
    configure_user_data_dir,
    prepare_user_data_dir,
    remove_user_data_dir,
)

if TYPE_CHECKING:
    from browser_commander.browser.real_browser import (
        RealBrowserOptions,
        RealBrowserResult,
    )

_CACHES = {
    "Cache",
    "Code Cache",
    "GPUCache",
    "DawnCache",
    "DawnGraphiteCache",
    "DawnWebGPUCache",
    "GrShaderCache",
    "ShaderCache",
}
_SESSIONS = {"Sessions", "Current Session", "Current Tabs", "Last Session", "Last Tabs"}
_LOG = logging.getLogger(__name__)


def snapshot_skip_reason(relative_path: str) -> str | None:
    """The same excluded files and directories as the JavaScript snapshotter."""
    name = relative_path.split("/")[-1]
    if name.startswith("Singleton") or name in {"lockfile", "LOCK"}:
        return "lock"
    if name in _CACHES or relative_path.endswith("Service Worker/CacheStorage"):
        return "cache"
    if name == "Crashpad":
        return "crash-reports"
    if name in _SESSIONS:
        return "session"
    if name.endswith(("-journal", "-wal", "-shm")):
        return "sqlite-sidecar"
    return None


def validate_profile_name(profile: str) -> None:
    """Refuse path traversal before reading or writing any profile."""
    if not profile or profile in {".", ".."} or any(c in profile for c in "/\\\0"):
        raise ValueError(
            "profile must be a directory name such as Default or Profile 1"
        )


def _copy_database(source: Path, target: Path) -> None:
    _LOG.debug("Backing up live profile database %s", source)

    def copy(snapshot: Path) -> None:
        with (
            contextlib.closing(
                sqlite3.connect(f"{snapshot.resolve().as_uri()}?mode=ro", uri=True)
            ) as reader,
            contextlib.closing(sqlite3.connect(target)) as writer,
        ):
            reader.backup(writer)
            writer.execute("PRAGMA journal_mode=DELETE")

    with_database_snapshot(source, copy)


def snapshot_user_data_dir(
    *,
    browser: str,
    profile: str = "Default",
    user_data_dir: str | Path | None = None,
    to: str | Path | None = None,
) -> dict[str, Any]:
    """Copy one live profile, folding committed SQLite WAL data into each database.

    The source stays read-only. Locks, caches, sessions, sidecars, symlinks and
    special files are skipped and reported. An explicit destination must be
    empty and outside the source. Without one, the caller owns a temporary copy.
    """
    browser = normalize_cookie_browser(browser)
    if browser == "firefox":
        raise ValueError("snapshot attach requires a Chromium-family browser")
    validate_profile_name(profile)
    source = (
        Path(user_data_dir)
        if user_data_dir is not None
        else browser_profile_root(browser)
    )
    source_profile = source / profile
    if source_profile.is_symlink() or not source_profile.is_dir():
        raise ValueError(f"No {browser} profile {profile} found at {source_profile}")
    if to is None:
        target = Path(tempfile.mkdtemp(prefix="browser-commander-profile-"))
    else:
        target = Path(to)
        if (
            target.resolve() == source.resolve()
            or source.resolve() in target.resolve().parents
        ):
            raise ValueError("snapshot target must not be inside the source")
        target.mkdir(parents=True, exist_ok=True)
        if any(target.iterdir()):
            raise ValueError("snapshot target must be empty")
    report: dict[str, Any] = {
        "source": {"browser": browser, "profile": profile, "userDataDir": str(source)},
        "target": str(target),
        "copied": {"files": 0, "databases": 0},
        "skipped": [],
        "warnings": [],
    }

    def copy(relative: Path) -> None:
        item = relative.as_posix()
        src, dst = source / relative, target / relative
        reason = snapshot_skip_reason(item)
        try:
            mode = src.lstat().st_mode
            if reason is None and stat.S_ISLNK(mode):
                reason = "symlink"
            if reason:
                report["skipped"].append({"item": item, "reason": reason})
            elif stat.S_ISDIR(mode):
                dst.mkdir(parents=True, exist_ok=True)
                for entry in sorted(src.iterdir()):
                    copy(relative / entry.name)
            elif stat.S_ISREG(mode):
                dst.parent.mkdir(parents=True, exist_ok=True)
                with src.open("rb") as handle:
                    sqlite = handle.read(16) == b"SQLite format 3\0"
                if sqlite:
                    _copy_database(src, dst)
                    report["copied"]["databases"] += 1
                else:
                    shutil.copyfile(src, dst)
                report["copied"]["files"] += 1
            else:
                report["skipped"].append({"item": item, "reason": "special-file"})
        except (OSError, sqlite3.Error) as error:
            # An unsuccessful backup can leave an empty or partial file. The
            # destination is our copy; never leave that file for Chrome to open.
            if dst.is_file():
                dst.unlink(missing_ok=True)
            report["skipped"].append(
                {"item": item, "reason": "unreadable", "detail": str(error)}
            )

    try:
        if (source / "Local State").exists():
            copy(Path("Local State"))
        copy(Path(profile))
        prepare_user_data_dir(target)
        prefs_path = target / profile / "Preferences"
        if prefs_path.exists():
            prefs = json.loads(prefs_path.read_text(encoding="utf-8"))
            prefs["profile"] = {
                **prefs.get("profile", {}),
                "exit_type": "Normal",
                "exited_cleanly": True,
            }
            prefs_path.write_text(json.dumps(prefs), encoding="utf-8")
        configure_user_data_dir(target, profile_directory=profile)
        return report
    except BaseException:
        if to is None:
            remove_user_data_dir(target)
        raise


@dataclass(frozen=True)
class SnapshotOptions:
    """Source of a temporary snapshot launch; the original browser stays open."""

    browser: str = "chrome"
    profile: str = "Default"
    user_data_dir: str | Path | None = None


async def launch_snapshot(
    source: SnapshotOptions, options: RealBrowserOptions | None = None
) -> RealBrowserResult:
    """Launch and own a native profile copy, deleting it after browser shutdown."""
    from browser_commander.browser.real_browser import (
        RealBrowserOptions,
        launch_real_browser_with_dependencies,
    )

    options = options or RealBrowserOptions(channel=source.browser)
    if options.user_data_dir or options.migrate_from:
        raise ValueError(
            "snapshot is mutually exclusive with user_data_dir and migrate_from"
        )
    if any(
        arg.split("=")[0] == "--profile-directory"
        for arg in [*options.args, *options.extra_args]
    ):
        raise ValueError(
            "snapshot manages --profile-directory; use SnapshotOptions.profile"
        )
    copying = asyncio.create_task(
        asyncio.to_thread(
            snapshot_user_data_dir,
            browser=source.browser,
            profile=source.profile,
            user_data_dir=source.user_data_dir,
        )
    )
    try:
        report = await asyncio.shield(copying)
    except asyncio.CancelledError:
        # Cancelling a thread's await does not stop its filesystem work.
        # Wait for it and delete the result before propagating cancellation.
        report = await copying
        await asyncio.to_thread(remove_user_data_dir, report["target"])
        raise
    directory = report["target"]
    try:
        result = await launch_real_browser_with_dependencies(
            replace(
                options,
                user_data_dir=directory,
                profile_directory=source.profile,
                args=[f"--profile-directory={source.profile}", *options.args],
            ),
            owned_profile=True,
        )
    except BaseException:
        await asyncio.to_thread(remove_user_data_dir, directory)
        raise
    result.snapshot = report
    return result
