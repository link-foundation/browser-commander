"""Unit tests for browser media emulation."""

from __future__ import annotations

import pytest

from browser_commander.browser.media import emulate_media


class MockPlaywrightPage:
    """Mock Playwright page for testing."""

    def __init__(self):
        self.emulate_media_calls = []

    async def emulate_media(self, **kwargs):
        self.emulate_media_calls.append(kwargs)


class MockSeleniumDriver:
    """Mock Selenium driver for testing."""

    def __init__(self):
        self.cdp_calls = []

    def execute_cdp_cmd(self, cmd: str, params: dict):
        self.cdp_calls.append({"cmd": cmd, "params": params})


class TestEmulateMediaValidation:
    """Test input validation for emulate_media."""

    @pytest.mark.asyncio
    async def test_raises_if_page_is_none(self):
        with pytest.raises(ValueError, match="page is required"):
            await emulate_media(None, "playwright", "dark")

    @pytest.mark.asyncio
    async def test_raises_if_engine_is_empty(self):
        page = MockPlaywrightPage()
        with pytest.raises(ValueError, match="engine is required"):
            await emulate_media(page, "", "dark")

    @pytest.mark.asyncio
    async def test_raises_for_invalid_color_scheme(self):
        page = MockPlaywrightPage()
        with pytest.raises(ValueError, match="Invalid color_scheme"):
            await emulate_media(page, "playwright", "invalid")

    @pytest.mark.asyncio
    async def test_raises_for_unsupported_engine(self):
        page = MockPlaywrightPage()
        with pytest.raises(ValueError, match="Unsupported engine"):
            await emulate_media(page, "puppeteer", "dark")


class TestEmulateMediaPlaywright:
    """Test emulate_media with Playwright engine."""

    @pytest.mark.asyncio
    async def test_dark_color_scheme(self):
        page = MockPlaywrightPage()
        await emulate_media(page, "playwright", "dark")
        assert page.emulate_media_calls == [{"color_scheme": "dark"}]

    @pytest.mark.asyncio
    async def test_light_color_scheme(self):
        page = MockPlaywrightPage()
        await emulate_media(page, "playwright", "light")
        assert page.emulate_media_calls == [{"color_scheme": "light"}]

    @pytest.mark.asyncio
    async def test_no_preference_color_scheme(self):
        page = MockPlaywrightPage()
        await emulate_media(page, "playwright", "no-preference")
        assert page.emulate_media_calls == [{"color_scheme": "no-preference"}]

    @pytest.mark.asyncio
    async def test_none_color_scheme_calls_with_empty_options(self):
        page = MockPlaywrightPage()
        await emulate_media(page, "playwright", None)
        assert page.emulate_media_calls == [{}]

    @pytest.mark.asyncio
    async def test_no_color_scheme_argument_calls_with_empty_options(self):
        page = MockPlaywrightPage()
        await emulate_media(page, "playwright")
        assert page.emulate_media_calls == [{}]


class TestEmulateMediaSelenium:
    """Test emulate_media with Selenium engine."""

    @pytest.mark.asyncio
    async def test_dark_color_scheme(self):
        driver = MockSeleniumDriver()
        await emulate_media(driver, "selenium", "dark")
        assert driver.cdp_calls == [
            {
                "cmd": "Emulation.setEmulatedMedia",
                "params": {
                    "features": [{"name": "prefers-color-scheme", "value": "dark"}]
                },
            }
        ]

    @pytest.mark.asyncio
    async def test_light_color_scheme(self):
        driver = MockSeleniumDriver()
        await emulate_media(driver, "selenium", "light")
        assert driver.cdp_calls == [
            {
                "cmd": "Emulation.setEmulatedMedia",
                "params": {
                    "features": [{"name": "prefers-color-scheme", "value": "light"}]
                },
            }
        ]

    @pytest.mark.asyncio
    async def test_no_preference_color_scheme(self):
        driver = MockSeleniumDriver()
        await emulate_media(driver, "selenium", "no-preference")
        assert driver.cdp_calls == [
            {
                "cmd": "Emulation.setEmulatedMedia",
                "params": {
                    "features": [
                        {"name": "prefers-color-scheme", "value": "no-preference"}
                    ]
                },
            }
        ]

    @pytest.mark.asyncio
    async def test_none_color_scheme_resets_with_empty_string(self):
        driver = MockSeleniumDriver()
        await emulate_media(driver, "selenium", None)
        assert driver.cdp_calls == [
            {
                "cmd": "Emulation.setEmulatedMedia",
                "params": {
                    "features": [{"name": "prefers-color-scheme", "value": ""}]
                },
            }
        ]
