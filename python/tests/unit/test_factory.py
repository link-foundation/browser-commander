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
