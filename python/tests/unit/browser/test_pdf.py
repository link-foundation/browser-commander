"""Tests for PDF generation support."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from browser_commander.browser.pdf import pdf
from browser_commander.core.engine_adapter import PlaywrightAdapter, SeleniumAdapter
from tests.helpers.mocks import create_mock_playwright_page


class TestPdfFunction:
    """Tests for the browser.pdf.pdf() function."""

    @pytest.mark.asyncio
    async def test_playwright_returns_bytes(self) -> None:
        """pdf() should return bytes for Playwright engine."""
        page = create_mock_playwright_page()
        result = await pdf(page, "playwright")
        assert isinstance(result, (bytes, bytearray, memoryview))

    @pytest.mark.asyncio
    async def test_playwright_passes_options(self) -> None:
        """pdf() should forward options to the underlying page.pdf()."""
        page = create_mock_playwright_page()
        captured: dict = {}

        async def mock_pdf(**opts):  # type: ignore[no-untyped-def]
            captured.update(opts)
            return b"%PDF-1.4"

        page.pdf = mock_pdf

        await pdf(
            page,
            "playwright",
            format="A4",
            print_background=True,
            margin={"top": "1cm", "right": "1cm", "bottom": "1cm", "left": "1cm"},
        )

        assert captured["format"] == "A4"
        assert captured["print_background"] is True
        assert captured["margin"] == {
            "top": "1cm",
            "right": "1cm",
            "bottom": "1cm",
            "left": "1cm",
        }

    @pytest.mark.asyncio
    async def test_selenium_prints_natively(self) -> None:
        """pdf() should decode the native WebDriver Print Page response."""
        mock_driver = MagicMock()
        mock_driver.current_url = "https://example.com"

        mock_driver.print_page.return_value = "JVBERi0xLjQ="
        assert await pdf(mock_driver, "selenium") == b"%PDF-1.4"


class TestPlaywrightAdapterPdf:
    """Tests for PlaywrightAdapter.pdf()."""

    @pytest.mark.asyncio
    async def test_returns_bytes(self) -> None:
        """PlaywrightAdapter.pdf() should return bytes."""
        page = create_mock_playwright_page()
        adapter = PlaywrightAdapter(page)
        result = await adapter.pdf(format="A4")
        assert isinstance(result, (bytes, bytearray, memoryview))

    @pytest.mark.asyncio
    async def test_passes_options_to_page(self) -> None:
        """PlaywrightAdapter.pdf() should pass kwargs to page.pdf()."""
        page = create_mock_playwright_page()
        captured: dict = {}

        async def mock_pdf(**opts):  # type: ignore[no-untyped-def]
            captured.update(opts)
            return b"%PDF-1.4"

        page.pdf = mock_pdf
        adapter = PlaywrightAdapter(page)
        await adapter.pdf(format="Letter", print_background=False)

        assert captured["format"] == "Letter"
        assert captured["print_background"] is False


class TestSeleniumAdapterPdf:
    """Tests for native SeleniumAdapter.pdf()."""

    @pytest.mark.asyncio
    async def test_prints_natively(self) -> None:
        """SeleniumAdapter.pdf() should return native PDF bytes."""
        mock_driver = MagicMock()
        adapter = SeleniumAdapter(mock_driver)
        mock_driver.print_page.return_value = "JVBERi0xLjQ="
        assert await adapter.pdf(format="A4") == b"%PDF-1.4"
