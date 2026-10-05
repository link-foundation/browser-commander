"""A live profile copy must retain committed WAL data without changing its source."""

from __future__ import annotations

import contextlib
import json
import sqlite3
from pathlib import Path
from typing import Any

import pytest

from browser_commander.browser.snapshot import snapshot_user_data_dir


def test_locked_snapshot_reports_guidance_without_target_database(
    tmp_path: Path,
) -> None:
    source = tmp_path / "source"
    profile = source / "Default"
    profile.mkdir(parents=True)
    with contextlib.closing(sqlite3.connect(profile / "History")) as writer:
        writer.execute("create table visits(url text)")
        writer.commit()
        writer.execute("begin exclusive")
        try:
            report = snapshot_user_data_dir(
                browser="chrome", user_data_dir=source, to=tmp_path / "target"
            )
            assert report["copied"]["databases"] == 0
            assert not (Path(report["target"]) / "Default/History").exists()
            assert any(
                entry["item"] == "Default/History"
                and entry["reason"] == "unreadable"
                and "Consistent SQLite snapshot unavailable" in entry["detail"]
                for entry in report["skipped"]
            )
        finally:
            writer.rollback()


# feature-parity: attach.snapshot@native-typed
def test_snapshot_live_wal_and_selected_profile(tmp_path: Path) -> None:
    source = tmp_path / "source"
    profile = source / "Profile 1"
    profile.mkdir(parents=True)
    prefs = {
        "browser": {"check_default_browser": True},
        "profile": {"exit_type": "Crashed"},
    }
    (profile / "Preferences").write_text(json.dumps(prefs))
    (source / "Local State").write_text('{"os_crypt":{"encrypted_key":"kept"}}')
    (profile / "Cache").mkdir()
    (profile / "Cache" / "discard").write_text("cached")
    (profile / "Sessions").mkdir()
    (profile / "LOCK").write_text("lock")
    with contextlib.closing(sqlite3.connect(profile / "History")) as database:
        database.execute("pragma journal_mode=wal")
        database.execute("pragma wal_autocheckpoint=0")
        database.execute("create table visits(url text)")
        database.execute("insert into visits values ('https://example.test')")
        database.commit()
        database.execute("begin immediate")
        database.execute("insert into visits values ('uncommitted')")
        report = snapshot_user_data_dir(
            browser="chrome",
            user_data_dir=source,
            profile="Profile 1",
            to=tmp_path / "copy",
        )
        with contextlib.closing(
            sqlite3.connect(Path(report["target"]) / "Profile 1" / "History")
        ) as copied:
            assert copied.execute("select url from visits").fetchall() == [
                ("https://example.test",)
            ]
        database.rollback()
    target = Path(report["target"])
    assert json.loads((profile / "Preferences").read_text()) == prefs
    copied_prefs = json.loads((target / "Profile 1" / "Preferences").read_text())
    assert copied_prefs["profile"]["exit_type"] == "Normal"
    assert copied_prefs["browser"]["check_default_browser"] is False
    assert (
        json.loads((target / "Local State").read_text())["os_crypt"]["encrypted_key"]
        == "kept"
    )
    assert report["copied"]["databases"] == 1
    assert not (target / "Profile 1" / "History-wal").exists()
    assert not (target / "Profile 1" / "Cache").exists()
    assert {item["reason"] for item in report["skipped"]} >= {
        "cache",
        "lock",
        "session",
        "sqlite-sidecar",
    }


@pytest.mark.parametrize(
    "profile", ["..", "../Default", "Profile/1", "Profile\\1", ".", ""]
)
def test_snapshot_rejects_profile_traversal(tmp_path: Path, profile: str) -> None:
    with pytest.raises(ValueError, match="profile"):
        snapshot_user_data_dir(
            browser="chrome", user_data_dir=tmp_path, profile=profile
        )


def test_snapshot_rejects_target_inside_source_and_nonempty_target(
    tmp_path: Path,
) -> None:
    source = tmp_path / "source"
    (source / "Default").mkdir(parents=True)
    with pytest.raises(ValueError, match="inside"):
        snapshot_user_data_dir(
            browser="chrome", user_data_dir=source, to=source / "copy"
        )
    with pytest.raises(ValueError, match="empty"):
        snapshot_user_data_dir(browser="chrome", user_data_dir=source, to=tmp_path)


def test_snapshot_does_not_follow_symlinks(tmp_path: Path) -> None:
    source = tmp_path / "source"
    (source / "Default").mkdir(parents=True)
    external = tmp_path / "external"
    external.write_text("private")
    try:
        (source / "Default" / "link").symlink_to(external)
    except OSError:
        pytest.skip("symlinks unavailable")
    report = snapshot_user_data_dir(
        browser="chrome", user_data_dir=source, to=tmp_path / "copy"
    )
    assert not (Path(report["target"]) / "Default" / "link").exists()
    assert report["skipped"] == [{"item": "Default/link", "reason": "symlink"}]


def test_snapshot_excludes_failed_partial_database(tmp_path: Path) -> None:
    source = tmp_path / "source"
    (source / "Default").mkdir(parents=True)
    corrupted = b"SQLite format 3\0" + b"corrupted" * 128
    (source / "Default" / "History").write_bytes(corrupted)
    report = snapshot_user_data_dir(
        browser="chrome", user_data_dir=source, to=tmp_path / "copy"
    )
    assert not (Path(report["target"]) / "Default" / "History").exists()
    assert report["skipped"][0]["reason"] == "unreadable"
    assert (source / "Default" / "History").read_bytes() == corrupted


async def test_cancelled_snapshot_waits_for_copy_and_removes_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import asyncio
    import threading

    from browser_commander import SnapshotOptions, launch_snapshot
    from browser_commander.browser import snapshot

    source = tmp_path / "source"
    (source / "Default").mkdir(parents=True)
    (source / "Default" / "keep").write_text("original")
    ready, release = threading.Event(), threading.Event()
    targets: list[Path] = []
    original = snapshot.snapshot_user_data_dir

    def copying(**kwargs: Any) -> dict[str, Any]:
        report = original(**kwargs)
        targets.append(Path(report["target"]))
        ready.set()
        assert release.wait(5), "test failed to release the snapshot thread"
        return report

    monkeypatch.setattr(snapshot, "snapshot_user_data_dir", copying)
    task = asyncio.create_task(launch_snapshot(SnapshotOptions(user_data_dir=source)))
    try:
        assert await asyncio.to_thread(ready.wait, 3)
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done()
    finally:
        release.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not targets[0].exists()
    assert (source / "Default" / "keep").read_text() == "original"


@pytest.mark.parametrize("failure", [False, True])
async def test_snapshot_launch_owns_copy_and_preserves_source(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: bool
) -> None:
    from browser_commander import RealBrowserOptions, SnapshotOptions, launch_snapshot
    from browser_commander.browser import real_browser
    from browser_commander.browser.launcher import LaunchResult

    source = tmp_path / "source"
    (source / "Profile 1").mkdir(parents=True)
    (source / "Profile 1" / "keep").write_text("original")
    launched_paths: list[Path] = []

    class Process:
        exit_code: int | None = None

        def once(self, event: str, callback: Any) -> None:
            self.callback = callback

        def kill(self) -> None:
            self.exit_code = 0
            self.callback(0)

    process = Process()

    class Browser:
        async def close(self) -> None:
            process.kill()

    browser = Browser()

    async def connect(options: Any) -> LaunchResult:
        if failure:
            raise RuntimeError("connection failed")
        return LaunchResult(browser=browser, page=None)

    original = real_browser.launch_real_browser_with_dependencies

    async def launch(options: RealBrowserOptions, *, owned_profile: bool) -> Any:
        launched_paths.append(Path(str(options.user_data_dir)))
        assert options.profile_directory == "Profile 1"
        assert "--profile-directory=Profile 1" in options.args
        return await original(
            options,
            owned_profile=owned_profile,
            resolve_executable=lambda **_kwargs: "/test/chrome",
            reserve_port=lambda: 9333,
            spawn_browser=lambda *_args, **_kwargs: process,
            wait_for_endpoint=lambda **_kwargs: "http://127.0.0.1:9333",
            connect=connect,
        )

    monkeypatch.setattr(real_browser, "launch_real_browser_with_dependencies", launch)
    request = SnapshotOptions(user_data_dir=source, profile="Profile 1")
    if failure:
        with pytest.raises(RuntimeError, match="connection failed"):
            await launch_snapshot(request)
    else:
        result = await launch_snapshot(request)
        assert result.temporary_profile
        assert result.snapshot is not None
        assert launched_paths[0].is_dir()
        # The native Playwright handle must own cleanup as well as result.close().
        await result.browser.close()
        assert result.close is not None
        await result.close()
    assert not launched_paths[0].exists()
    assert (source / "Profile 1" / "keep").read_text() == "original"
