"""Reproduce `Locator.first` being called as a method on real Playwright.

Run: python/.venv/bin/python experiments/python-locator-first/repro.py
"""

import asyncio

from playwright.async_api import async_playwright

from browser_commander import make_browser_commander


async def main() -> None:
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, args=["--no-sandbox"])
        page = await browser.new_page()
        await page.set_content(
            "<button id=go onclick=\"this.textContent='clicked'\">go</button>"
            "<textarea id=note></textarea>"
        )
        commander = make_browser_commander(page, enable_network_tracking=False)
        for name, action in [
            ("click_button", lambda: commander.click_button("#go")),
            ("fill_text_area", lambda: commander.fill_text_area("#note", "hi")),
            ("query_selector", lambda: commander.query_selector("#go")),
            ("is_enabled", lambda: commander.is_enabled("#go")),
        ]:
            try:
                result = await action()
                print(f"{name}: ok {result!r}"[:120])
            except Exception as error:
                print(f"{name}: {type(error).__name__}: {error}")
        print("button:", await page.text_content("#go"))
        print("note:", await page.input_value("#note"))
        await browser.close()


asyncio.run(main())
