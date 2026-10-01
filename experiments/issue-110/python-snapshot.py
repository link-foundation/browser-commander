"""Run native Playwright/Selenium snapshot copies against the installed Chrome.

Run: PYTHONPATH=python/src .venv/bin/python experiments/issue-110/python-snapshot.py
The source Profile 1 stays open while each copy launches and shuts down.
"""

import asyncio
import faulthandler
import logging
import tempfile
from pathlib import Path

from browser_commander import (
    RealBrowserOptions,
    SnapshotOptions,
    launch_real_browser,
    launch_snapshot,
)


async def main() -> None:
    faulthandler.dump_traceback_later(45)
    logging.basicConfig(level=logging.DEBUG)
    with tempfile.TemporaryDirectory(prefix="bc-snapshot-source-") as directory:
        source_path = Path(directory)
        source = await launch_real_browser(
            RealBrowserOptions(
                user_data_dir=directory,
                profile_directory="Profile 1",
                headless=True,
                args=["--no-sandbox", "--profile-directory=Profile 1"],
            )
        )
        try:
            await source.page.goto("data:text/html,<title>original</title>")
            for engine in ("playwright", "selenium"):
                copy = await launch_snapshot(
                    SnapshotOptions(profile="Profile 1", user_data_dir=directory),
                    RealBrowserOptions(
                        engine=engine, headless=True, args=["--no-sandbox"]
                    ),
                )
                target = Path(copy.user_data_dir)
                try:
                    assert copy.temporary_profile
                    assert copy.snapshot["source"]["profile"] == "Profile 1"
                    assert target != source_path
                    assert target.joinpath("Profile 1", "Preferences").is_file()
                    if engine == "playwright":
                        await copy.page.goto("data:text/html,<title>copy</title>")
                        assert await copy.page.title() == "copy"
                    else:
                        copy.page.get("data:text/html,<title>copy</title>")
                        assert copy.page.title == "copy"
                finally:
                    await copy.close()
                assert not target.exists()
                assert await source.page.title() == "original"
                print(
                    f"{engine}: selected profile launched, copy deleted, original still open"
                )
        finally:
            await source.close()
    faulthandler.cancel_dump_traceback_later()


if __name__ == "__main__":
    asyncio.run(main())
