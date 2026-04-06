"""Tests for factory module."""

from unittest.mock import MagicMock

from browser_commander.factory import BrowserCommander, make_browser_commander


class TestBrowserCommander:
    """Tests for BrowserCommander class."""

    def test_creates_instance(self) -> None:
        """Should create instance."""
        mock_page = MagicMock()
        mock_page.locator = MagicMock()
        mock_page.context = MagicMock()
        mock_page.on = MagicMock()

        commander = BrowserCommander(
            page=mock_page,
            enable_network_tracking=False,
            enable_navigation_manager=False,
        )

        assert commander is not None
        assert commander.page is mock_page
        assert commander.engine == "playwright"

    def test_creates_instance_with_options(self) -> None:
        """Should create instance with options."""
        mock_page = MagicMock()
        mock_page.locator = MagicMock()
        mock_page.context = MagicMock()
        mock_page.on = MagicMock()

        commander = BrowserCommander(
            page=mock_page,
            verbose=True,
            enable_network_tracking=False,
            enable_navigation_manager=False,
        )

        assert commander is not None
        assert commander._verbose is True


class TestMakeBrowserCommander:
    """Tests for make_browser_commander function."""

    def test_creates_browser_commander(self) -> None:
        """Should create BrowserCommander instance."""
        mock_page = MagicMock()
        mock_page.locator = MagicMock()
        mock_page.context = MagicMock()
        mock_page.on = MagicMock()

        commander = make_browser_commander(
            page=mock_page,
            enable_network_tracking=False,
            enable_navigation_manager=False,
        )

        assert isinstance(commander, BrowserCommander)

    def test_creates_commander_with_verbose(self) -> None:
        """Should create commander with verbose enabled."""
        mock_page = MagicMock()
        mock_page.locator = MagicMock()
        mock_page.context = MagicMock()
        mock_page.on = MagicMock()

        commander = make_browser_commander(
            page=mock_page,
            verbose=True,
            enable_network_tracking=False,
            enable_navigation_manager=False,
        )

        assert commander._verbose is True


class TestExtensibilityEscapeHatch:
    """Tests for extensibility escape hatch (issue #39).

    Verifies that commander.page exposes the raw underlying engine page object,
    enabling users to call engine-specific APIs not yet supported by browser-commander.
    """

    def test_commander_page_is_raw_page(self) -> None:
        """commander.page must be the exact raw page object (not a wrapper)."""
        mock_page = MagicMock()
        mock_page.locator = MagicMock()
        mock_page.context = MagicMock()
        mock_page.on = MagicMock()

        commander = BrowserCommander(
            page=mock_page,
            enable_network_tracking=False,
            enable_navigation_manager=False,
        )

        # The raw page must be accessible as commander.page (the official escape hatch)
        assert commander.page is mock_page, (
            "commander.page must be the raw engine page (not a wrapper)"
        )

    def test_commander_page_allows_engine_specific_api_calls(self) -> None:
        """Users can call engine-specific APIs via commander.page without _page hacks."""
        mock_page = MagicMock()
        mock_page.locator = MagicMock()
        mock_page.context = MagicMock()
        mock_page.on = MagicMock()
        # Simulate an engine-specific API not in browser-commander (e.g. pdf(), emulate_media())
        mock_page.custom_engine_method = MagicMock(return_value="engine-result")

        commander = BrowserCommander(
            page=mock_page,
            enable_network_tracking=False,
            enable_navigation_manager=False,
        )

        # Users can call engine-specific methods via commander.page
        result = commander.page.custom_engine_method()
        assert result == "engine-result", (
            "commander.page should allow calling engine-specific APIs"
        )
        mock_page.custom_engine_method.assert_called_once()

    def test_make_browser_commander_page_is_raw_page(self) -> None:
        """make_browser_commander also exposes raw page via commander.page."""
        mock_page = MagicMock()
        mock_page.locator = MagicMock()
        mock_page.context = MagicMock()
        mock_page.on = MagicMock()

        commander = make_browser_commander(
            page=mock_page,
            enable_network_tracking=False,
            enable_navigation_manager=False,
        )

        assert commander.page is mock_page, (
            "make_browser_commander result must expose raw page via commander.page"
        )
