"""Mock utilities for unit tests."""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass
from typing import Any, Callable
from unittest.mock import AsyncMock, MagicMock


@dataclass
class MockElementData:
    """Mock element data."""

    count: int = 1
    visible: bool = True
    enabled: bool = True
    text_content: str = "Mock text"
    value: str = ""
    class_name: str = "mock-class"
    checked: bool = False


def create_mock_playwright_page(
    url: str = "https://example.com",
    elements: dict[str, MockElementData] | None = None,
    evaluate_result: Any = None,
) -> MagicMock:
    """Create a mock Playwright page object.

    Args:
        url: Current page URL
        elements: Mock element data by selector
        evaluate_result: Result to return from evaluate

    Returns:
        Mock Playwright page
    """
    elements = elements or {}
    event_listeners: dict[str, list[Callable]] = {}

    def get_element_data(selector: str) -> MockElementData:
        return elements.get(selector, MockElementData())

    def create_locator(selector: str) -> MagicMock:
        element_data = get_element_data(selector)
        locator = MagicMock()
        locator.count = AsyncMock(return_value=element_data.count)
        locator.first.return_value = locator
        locator.nth.return_value = locator
        locator.last.return_value = locator
        locator.click = AsyncMock()
        locator.fill = AsyncMock()
        locator.type = AsyncMock()
        locator.focus = AsyncMock()
        locator.text_content = AsyncMock(return_value=element_data.text_content)
        locator.input_value = AsyncMock(return_value=element_data.value)
        locator.get_attribute = AsyncMock(return_value=None)
        locator.is_visible = AsyncMock(return_value=element_data.visible)
        locator.wait_for = AsyncMock()

        async def mock_evaluate(fn: Callable, arg: Any = None) -> Any:
            mock_el = MagicMock()
            mock_el.tagName = "DIV"
            mock_el.textContent = element_data.text_content
            mock_el.value = element_data.value
            mock_el.className = element_data.class_name
            mock_el.disabled = not element_data.enabled
            mock_el.checked = element_data.checked
            mock_el.isConnected = True
            mock_el.offsetWidth = 100 if element_data.visible else 0
            mock_el.offsetHeight = 50 if element_data.visible else 0
            return fn(mock_el, arg)

        locator.evaluate = mock_evaluate
        return locator

    page = MagicMock()
    page._is_playwright_page = True
    page.url.return_value = url
    page.goto = AsyncMock()
    page.wait_for_navigation = AsyncMock()
    page.wait_for_selector = AsyncMock(side_effect=lambda s, **_kw: create_locator(s))
    page.query_selector = AsyncMock(side_effect=lambda s: create_locator(s))
    page.query_selector_all = AsyncMock(
        side_effect=lambda s: [create_locator(s)] * get_element_data(s).count
    )
    page.locator = create_locator

    async def mock_evaluate(fn: Callable, arg: Any = None) -> Any:
        if evaluate_result is not None:
            return evaluate_result
        try:
            return fn(arg)
        except Exception:
            return fn

    page.evaluate = mock_evaluate
    page.main_frame.return_value.url.return_value = url
    page.context.return_value = MagicMock()
    page.bring_to_front = AsyncMock()

    def on_handler(event: str, handler: Callable) -> None:
        if event not in event_listeners:
            event_listeners[event] = []
        event_listeners[event].append(handler)

    def off_handler(event: str, handler: Callable) -> None:
        if event in event_listeners:
            with contextlib.suppress(ValueError):
                event_listeners[event].remove(handler)

    def emit(event: str, data: Any = None) -> None:
        if event in event_listeners:
            for h in event_listeners[event]:
                h(data)

    page.on = on_handler
    page.off = off_handler
    page.emit = emit
    page.click = AsyncMock()
    page.type = AsyncMock()
    page.keyboard = MagicMock()
    page.keyboard.type = AsyncMock()

    return page


def create_mock_selenium_driver(
    url: str = "https://example.com",
    elements: dict[str, MockElementData] | None = None,
) -> MagicMock:
    """Create a mock Selenium WebDriver.

    Args:
        url: Current page URL
        elements: Mock element data by selector

    Returns:
        Mock Selenium driver
    """
    elements = elements or {}

    def get_element_data(selector: str) -> MockElementData:
        return elements.get(selector, MockElementData())

    def create_element(selector: str) -> MagicMock:
        element_data = get_element_data(selector)
        element = MagicMock()
        element.click = MagicMock()
        element.send_keys = MagicMock()
        element.clear = MagicMock()
        element.text = element_data.text_content
        element.get_attribute = MagicMock(return_value=element_data.value)
        element.is_displayed = MagicMock(return_value=element_data.visible)
        element.is_enabled = MagicMock(return_value=element_data.enabled)
        element.location = {"x": 10, "y": 100}
        element.size = {"width": 100, "height": 50}
        return element

    driver = MagicMock()
    driver._is_selenium_driver = True
    driver.current_url = url
    driver.get = MagicMock()
    driver.find_element = MagicMock(side_effect=lambda _by, val: create_element(val))
    driver.find_elements = MagicMock(
        side_effect=lambda _by, val: [create_element(val)] * get_element_data(val).count
    )
    driver.execute_script = MagicMock(return_value=None)
    driver.execute_async_script = MagicMock(return_value=None)

    return driver


def create_mock_logger(collect_logs: bool = False) -> MagicMock:
    """Create a mock logger.

    Args:
        collect_logs: Whether to collect log entries

    Returns:
        Mock logger
    """
    logs: list[dict[str, Any]] = []

    def make_log_fn(level: str) -> Callable:
        def log_fn(fn_or_msg: Callable | str) -> None:
            if collect_logs:
                msg = fn_or_msg() if callable(fn_or_msg) else fn_or_msg
                logs.append({"level": level, "message": msg})

        return log_fn

    logger = MagicMock()
    logger.debug = make_log_fn("debug")
    logger.info = make_log_fn("info")
    logger.warn = make_log_fn("warn")
    logger.error = make_log_fn("error")
    logger.get_logs = lambda: logs
    logger.clear = lambda: logs.clear()

    return logger


def create_mock_network_tracker(
    initial_pending_count: int = 0,
    wait_for_idle_result: bool = True,
) -> MagicMock:
    """Create a mock network tracker.

    Args:
        initial_pending_count: Initial number of pending requests
        wait_for_idle_result: Result for wait_for_network_idle

    Returns:
        Mock network tracker
    """
    pending_count = initial_pending_count
    listeners: dict[str, list[Callable]] = {
        "on_request_start": [],
        "on_request_end": [],
        "on_network_idle": [],
    }

    tracker = MagicMock()
    tracker.start_tracking = MagicMock()
    tracker.stop_tracking = MagicMock()
    tracker.wait_for_network_idle = AsyncMock(return_value=wait_for_idle_result)
    tracker.get_pending_count = MagicMock(return_value=pending_count)
    tracker.get_pending_urls = MagicMock(return_value=[])
    tracker.reset = MagicMock()

    def on_handler(event: str, callback: Callable) -> None:
        if event in listeners:
            listeners[event].append(callback)

    def off_handler(event: str, callback: Callable) -> None:
        if event in listeners:
            with contextlib.suppress(ValueError):
                listeners[event].remove(callback)

    tracker.on = on_handler
    tracker.off = off_handler

    return tracker


def create_mock_navigation_manager(
    current_url: str = "https://example.com",
    is_navigating: bool = False,
    should_abort_value: bool = False,
) -> MagicMock:
    """Create a mock navigation manager.

    Args:
        current_url: Current URL
        is_navigating: Whether currently navigating
        should_abort_value: Value for should_abort

    Returns:
        Mock navigation manager
    """
    url = current_url
    navigating = is_navigating
    session_id = 1
    abort_signal = asyncio.Event()

    listeners: dict[str, list[Callable]] = {
        "on_navigation_start": [],
        "on_navigation_complete": [],
        "on_before_navigate": [],
        "on_url_change": [],
        "on_page_ready": [],
    }

    manager = MagicMock()
    manager.navigate = AsyncMock(return_value=True)
    manager.wait_for_navigation = AsyncMock(return_value=True)
    manager.wait_for_page_ready = AsyncMock(return_value=True)
    manager.is_navigating = MagicMock(return_value=navigating)
    manager.get_current_url = MagicMock(return_value=url)
    manager.get_session_id = MagicMock(return_value=session_id)
    manager.get_abort_signal = MagicMock(return_value=abort_signal)
    manager.should_abort = MagicMock(return_value=should_abort_value)
    manager.start_listening = MagicMock()
    manager.stop_listening = MagicMock()

    def on_handler(event: str, callback: Callable) -> None:
        if event in listeners:
            listeners[event].append(callback)

    def off_handler(event: str, callback: Callable) -> None:
        if event in listeners:
            with contextlib.suppress(ValueError):
                listeners[event].remove(callback)

    manager.on = on_handler
    manager.off = off_handler

    return manager


def create_navigation_error(
    message: str = "Execution context was destroyed",
) -> Exception:
    """Create a navigation error for testing.

    Args:
        message: Error message

    Returns:
        Navigation error
    """
    error = Exception(message)
    error.name = "NavigationError"
    return error
