"""Attach the Python Playwright API to a system Chrome over CDP."""

from __future__ import annotations

import asyncio
import shutil
import sys
import tempfile
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "python" / "src"))

from browser_commander import (
    ConnectOptions,
    connect_browser,
    make_browser_commander,
)


async def wait_for_cdp_port(profile: Path, process: asyncio.subprocess.Process) -> int:
    active_port = profile / "DevToolsActivePort"
    for _ in range(200):
        if process.returncode is not None:
            msg = f"Chrome exited before CDP was ready: {process.returncode}"
            raise RuntimeError(msg)
        try:
            return int(active_port.read_text().splitlines()[0])
        except (FileNotFoundError, IndexError, ValueError):
            await asyncio.sleep(0.1)
    msg = f"Timed out waiting for {active_port}"
    raise TimeoutError(msg)


async def main() -> None:
    if len(sys.argv) != 2:
        msg = "Usage: python experiments/connect-browser-python-smoke.py <browser>"
        raise RuntimeError(msg)

    profile = Path(tempfile.mkdtemp(prefix="browser-commander-python-cdp-"))
    process = await asyncio.create_subprocess_exec(
        sys.argv[1],
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        f"--user-data-dir={profile}",
        "--headless=new",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "about:blank",
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )

    try:
        port = await wait_for_cdp_port(profile, process)
        result = await connect_browser(
            ConnectOptions(
                engine="playwright",
                cdp_endpoint=f"http://127.0.0.1:{port}",
                timeout=20_000,
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
                "data:text/html,<main id=connected>CDP connection works</main>"
            )
            commander = make_browser_commander(
                result.page,
                enable_network_tracking=False,
                enable_navigation_manager=False,
                enable_dialog_manager=False,
            )
            assert await commander.count("#connected") == 1
            cookies = await result.page.context.cookies("https://example.com")
            assert any(cookie["name"] == "attached" for cookie in cookies)
            await commander.destroy()
            print("python playwright real-browser CDP smoke test passed")
        finally:
            await result.browser.close()
    finally:
        if process.returncode is None:
            process.terminate()
        await process.wait()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
