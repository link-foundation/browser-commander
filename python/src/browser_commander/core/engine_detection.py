"""Engine detection for browser automation frameworks."""

from typing import Any, Literal

from browser_commander.core.logger import is_verbose_enabled

EngineType = Literal["playwright", "selenium"]


def detect_engine(page_or_driver: Any) -> EngineType:
    """Detect which browser automation engine is being used.

    from __future__ import annotations

        Args:
            page_or_driver: Page or driver object from Playwright or Selenium

        Returns:
            Engine type: 'playwright' or 'selenium'

        Raises:
            ValueError: If the engine cannot be detected
    """
    # Check for Playwright-specific attributes
    has_locator = hasattr(page_or_driver, "locator") and callable(
        getattr(page_or_driver, "locator", None)
    )
    has_context = hasattr(page_or_driver, "context")
    has_goto = hasattr(page_or_driver, "goto") and callable(
        getattr(page_or_driver, "goto", None)
    )

    # Check for Selenium-specific attributes
    has_find_element = hasattr(page_or_driver, "find_element") and callable(
        getattr(page_or_driver, "find_element", None)
    )
    has_get = hasattr(page_or_driver, "get") and callable(
        getattr(page_or_driver, "get", None)
    )
    has_current_url = hasattr(page_or_driver, "current_url")

    if is_verbose_enabled():
        print(
            f"[ENGINE DETECTION] has_locator={has_locator}, "
            f"has_context={has_context}, has_goto={has_goto}, "
            f"has_find_element={has_find_element}, has_get={has_get}, "
            f"has_current_url={has_current_url}"
        )

    # Check for Playwright first (has locator() method and context)
    if has_locator and has_context and has_goto:
        if is_verbose_enabled():
            print("[ENGINE DETECTION] Detected: playwright")
        return "playwright"

    # Check for Selenium (has find_element and get methods)
    if has_find_element and has_get and has_current_url:
        if is_verbose_enabled():
            print("[ENGINE DETECTION] Detected: selenium")
        return "selenium"

    if is_verbose_enabled():
        print("[ENGINE DETECTION] Could not detect engine!")

    msg = (
        "Unknown browser automation engine. "
        "Expected Playwright Page or Selenium WebDriver object."
    )
    raise ValueError(msg)
