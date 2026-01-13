"""Tests for URL utilities."""

from unittest.mock import MagicMock

from browser_commander.utilities.url import get_url


class TestGetUrl:
    """Tests for get_url function."""

    def test_returns_url_for_playwright(self) -> None:
        """Should return URL for Playwright page."""
        mock_page = MagicMock()
        mock_page.url.return_value = "https://example.com"
        mock_page.locator = MagicMock()
        mock_page.context = MagicMock()

        url = get_url(mock_page)
        assert url == "https://example.com"

    def test_returns_url_for_selenium(self) -> None:
        """Should return URL for Selenium driver."""

        class MockSeleniumDriver:
            current_url = "https://selenium.example.com"

            def find_element(self, by: str, value: str) -> None:
                pass

        mock_driver = MockSeleniumDriver()
        url = get_url(mock_driver)
        assert url == "https://selenium.example.com"
