"""Keep a live source Profile 1 open while native engines launch its copies."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest

from browser_commander import (
    RealBrowserOptions,
    SnapshotOptions,
    launch_real_browser,
    launch_snapshot,
)

pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(
        os.environ.get("RUN_E2E", "").lower() not in {"1", "true", "yes"},
        reason="set RUN_E2E=true to run native snapshot launches",
    ),
]


@pytest.mark.parametrize("engine", ["playwright", "selenium"])
async def test_native_snapshot_owns_only_its_copy(engine: str, tmp_path: Path) -> None:
    async def exercise() -> None:
        args = ["--no-sandbox"] if os.environ.get("CHROME_NO_SANDBOX") == "true" else []
        source = await launch_real_browser(
            RealBrowserOptions(
                user_data_dir=str(tmp_path),
                profile_directory="Profile 1",
                headless=True,
                args=[*args, "--profile-directory=Profile 1"],
            )
        )
        try:
            await source.page.evaluate("document.title = 'original'")
            copy = await launch_snapshot(
                SnapshotOptions(profile="Profile 1", user_data_dir=str(tmp_path)),
                RealBrowserOptions(engine=engine, headless=True, args=args),
            )
            target = Path(copy.user_data_dir)
            try:
                assert copy.temporary_profile
                assert copy.snapshot is not None
                assert copy.snapshot["source"]["profile"] == "Profile 1"
                assert target.joinpath("Profile 1", "Preferences").is_file()
                if engine == "playwright":
                    await copy.page.evaluate("document.title = 'copy'")
                    assert await copy.page.title() == "copy"
                else:
                    copy.page.execute_script("document.title = 'copy'")
                    assert copy.page.title == "copy"
            finally:
                await copy.close()
            assert not target.exists()
            assert await source.page.title() == "original"
            assert tmp_path.exists()
        finally:
            await source.close()

    await asyncio.wait_for(exercise(), timeout=150)
