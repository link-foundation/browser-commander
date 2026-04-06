"""PDF generation support.

Wraps Playwright's page.pdf() method behind a unified interface.

Note: PDF generation only works with Playwright in Chromium headless mode.
Selenium/WebDriver does not support native PDF generation.
"""

from __future__ import annotations

from typing import Any

from browser_commander.core.engine_adapter import create_engine_adapter
from browser_commander.core.engine_detection import EngineType


async def pdf(page: Any, engine: EngineType, **options: Any) -> bytes:
    """Generate a PDF of the current page.

    Args:
        page: Playwright page or Selenium WebDriver object
        engine: Engine type ('playwright' or 'selenium')
        **options: PDF generation options forwarded to the underlying engine.
            Common options (Playwright):
            - format: Paper format (e.g. 'A4', 'Letter')
            - print_background: Print background graphics
            - margin: Dict with top/right/bottom/left margins
            - path: Optional file path to save the PDF

    Returns:
        PDF content as bytes

    Raises:
        NotImplementedError: If the engine does not support PDF generation
    """
    adapter = create_engine_adapter(page, engine)
    return await adapter.pdf(**options)
