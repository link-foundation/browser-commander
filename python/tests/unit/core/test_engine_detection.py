"""Tests for engine detection."""

from unittest.mock import MagicMock

import pytest

from browser_commander.core.engine_detection import detect_engine


class TestDetectEngine:
    """Tests for detect_engine function."""

    def test_detects_playwright_page(self) -> None:
        """Should detect Playwright page."""
        mock_page = MagicMock()
        mock_page.locator = MagicMock()  # Function-like
        mock_page.context = MagicMock()  # Has context

        engine = detect_engine(mock_page)
        assert engine == "playwright"

    def test_detects_selenium_driver(self) -> None:
        """Should detect Selenium driver."""
        mock_driver = MagicMock()
        mock_driver.find_element = MagicMock()
        mock_driver.current_url = "https://example.com"
        # Remove playwright-specific attributes
        del mock_driver.locator
        del mock_driver.context

        engine = detect_engine(mock_driver)
        assert engine == "selenium"

    def test_throws_error_for_unknown_engine(self) -> None:
        """Should throw error for unknown engine."""

        class UnknownPage:
            def some_method(self) -> None:
                pass

        mock_page = UnknownPage()

        with pytest.raises(ValueError, match="Unknown browser automation engine"):
            detect_engine(mock_page)

    def test_detects_playwright_when_locator_is_function_and_context_exists(
        self,
    ) -> None:
        """Should detect Playwright when locator is function and context exists."""
        mock_page = MagicMock()
        mock_page.locator = lambda _selector: MagicMock()
        mock_page.context = MagicMock()

        engine = detect_engine(mock_page)
        assert engine == "playwright"
