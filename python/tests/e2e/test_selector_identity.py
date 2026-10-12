"""Verify scoped selector identity with both native Python engines."""

import asyncio
import os
from urllib.parse import quote

import pytest

from browser_commander import LaunchOptions, launch_browser
from browser_commander.elements.locators import create_playwright_locator
from browser_commander.elements.selectors import (
    SeleniumTextSelector,
    normalize_selector,
)

pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(os.environ.get("RUN_E2E") != "true", reason="set RUN_E2E=true"),
]

HTML = """<nav><button>A</button><button data-qa='duplicate'>B</button></nav>
<div class='parent'><section><button>A</button>
<button data-qa='duplicate' onclick="window.clicked='B'">B</button></section></div>"""


@pytest.mark.parametrize("engine", ["playwright", "selenium"])
async def test_text_selector_keeps_matched_element(engine):
    async def exercise():
        session = await launch_browser(
            LaunchOptions(
                engine=engine,
                headless=True,
                args=["--no-sandbox"]
                if os.environ.get("CHROME_NO_SANDBOX") == "true"
                else [],
            )
        )
        try:
            page = session.page
            if engine == "playwright":
                await page.set_content(HTML)
            else:
                page.get("data:text/html," + quote(HTML))
            for exact in [False, True]:
                selector = (
                    (
                        '.parent button:text-is("B")'
                        if exact
                        else '.parent button:has-text("B")'
                    )
                    if engine == "playwright"
                    else SeleniumTextSelector(".parent button", "B", exact)
                )
                normalized = await normalize_selector(page, engine, selector)
                assert normalized
                if engine == "playwright":
                    await create_playwright_locator(page, normalized).click(
                        timeout=2000
                    )
                    assert await page.evaluate("() => window.clicked") == "B"
                else:
                    from selenium.webdriver.common.by import By

                    matches = page.find_elements(By.CSS_SELECTOR, normalized)
                    assert len(matches) == 1
                    matches[0].click()
                    assert page.execute_script("return window.clicked") == "B"
        finally:
            await session.close()

    await asyncio.wait_for(exercise(), timeout=60)
