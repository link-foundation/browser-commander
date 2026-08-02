"""Launch system Chrome through the Python real-browser lifecycle helper."""

from __future__ import annotations

import asyncio
import shutil
import sys
import tempfile
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "python" / "src"))

from browser_commander import (  # noqa: E402
    RealBrowserOptions,
    launch_real_browser,
    make_browser_commander,
)


async def main() -> None:
    executable = sys.argv[1] if len(sys.argv) > 1 else "/usr/bin/google-chrome"
    profile = Path(tempfile.mkdtemp(prefix="browser-commander-python-real-"))
    result = await launch_real_browser(
        RealBrowserOptions(
            engine="playwright",
            executable_path=executable,
            user_data_dir=str(profile),
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
            seed_cookies=[
                {
                    "name": "attached",
                    "value": "python",
                    "url": "https://example.com",
                }
            ],
        )
    )

    try:
        await result.page.goto(
            "data:text/html,<main id=connected>Real browser connection works</main>"
        )
        commander = make_browser_commander(
            result.page,
            enable_network_tracking=False,
            enable_navigation_manager=False,
            enable_dialog_manager=False,
        )
        assert await commander.count("#connected") == 1
        await commander.destroy()
        print("python real-browser launch-and-connect smoke test passed")
    finally:
        await result.browser.close()
        if result.browser_process.returncode is None:
            result.browser_process.terminate()
        await result.browser_process.wait()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
