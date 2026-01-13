"""Pytest configuration and fixtures."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from tests.helpers.mocks import (
    create_mock_logger,
    create_mock_navigation_manager,
    create_mock_network_tracker,
    create_mock_playwright_page,
    create_mock_selenium_driver,
)

if TYPE_CHECKING:
    from unittest.mock import MagicMock


@pytest.fixture
def mock_playwright_page() -> MagicMock:
    """Create a mock Playwright page."""
    return create_mock_playwright_page()


@pytest.fixture
def mock_selenium_driver() -> MagicMock:
    """Create a mock Selenium driver."""
    return create_mock_selenium_driver()


@pytest.fixture
def mock_logger() -> MagicMock:
    """Create a mock logger."""
    return create_mock_logger()


@pytest.fixture
def mock_network_tracker() -> MagicMock:
    """Create a mock network tracker."""
    return create_mock_network_tracker()


@pytest.fixture
def mock_navigation_manager() -> MagicMock:
    """Create a mock navigation manager."""
    return create_mock_navigation_manager()
