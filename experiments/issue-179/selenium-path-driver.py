"""Start Selenium's default Chrome for Testing with another chromedriver on PATH.

Selenium Manager returns a chromedriver found on PATH even for a
``--browser-path`` of another release, and that driver refuses to start the
browser ("This version of ChromeDriver only supports Chrome version 155").
Put a mismatched chromedriver first on PATH and run, from ``python/``:

    PATH=/dir/with/other/chromedriver:$PATH python ../experiments/issue-179/selenium-path-driver.py

Both the real launch (attach over CDP) and the engine launch must report a
driver of the browser's own major version.
"""

import asyncio

from browser_commander import LaunchOptions, launch_browser


async def main() -> None:
    for launch in ("real", "engine"):
        result = await launch_browser(
            LaunchOptions(
                engine="selenium", launch=launch, headless=True, args=["--no-sandbox"]
            )
        )
        try:
            caps = result.browser.capabilities
            driver = caps["chrome"]["chromedriverVersion"].split()[0]
            print(launch, "browser", caps["browserVersion"], "driver", driver)
        finally:
            await result.close()


asyncio.run(main())
