"""Tests for engine adapter."""

from unittest.mock import MagicMock, PropertyMock

import pytest

from browser_commander.core.engine_adapter import (
    PlaywrightAdapter,
    SeleniumAdapter,
    create_engine_adapter,
)


class TestPlaywrightAdapter:
    """Tests for PlaywrightAdapter."""

    def test_get_url_returns_current_url(self) -> None:
        """Should return current URL."""
        mock_page = MagicMock()
        # page.url is a property in Playwright, not a method
        type(mock_page).url = PropertyMock(return_value="https://example.com")

        adapter = PlaywrightAdapter(mock_page)
        assert adapter.get_url() == "https://example.com"


class TestSeleniumAdapter:
    """Tests for SeleniumAdapter."""

    def test_get_url_returns_current_url(self) -> None:
        """Should return current URL."""
        mock_driver = MagicMock()
        mock_driver.current_url = "https://example.com"

        adapter = SeleniumAdapter(mock_driver)
        assert adapter.get_url() == "https://example.com"


class TestCreateEngineAdapter:
    """Tests for create_engine_adapter function."""

    def test_creates_playwright_adapter_for_playwright_engine(self) -> None:
        """Should create PlaywrightAdapter for playwright engine."""
        mock_page = MagicMock()
        adapter = create_engine_adapter(mock_page, "playwright")
        assert isinstance(adapter, PlaywrightAdapter)

    def test_creates_selenium_adapter_for_selenium_engine(self) -> None:
        """Should create SeleniumAdapter for selenium engine."""
        mock_driver = MagicMock()
        adapter = create_engine_adapter(mock_driver, "selenium")
        assert isinstance(adapter, SeleniumAdapter)

    def test_throws_error_for_invalid_engine(self) -> None:
        """Should throw error for invalid engine."""
        mock_page = MagicMock()
        with pytest.raises(ValueError, match="Unsupported engine"):
            create_engine_adapter(mock_page, "invalid")  # type: ignore
