"""Media emulation for browser-commander.

Provides unified color scheme emulation across Playwright and Selenium.
"""

from __future__ import annotations

from typing import Any, Literal

ColorScheme = Literal["light", "dark", "no-preference"]

VALID_COLOR_SCHEMES = ("light", "dark", "no-preference")


async def emulate_media(
    page: Any,
    engine: str,
    color_scheme: ColorScheme | None = None,
) -> None:
    """Emulate media features (e.g. prefers-color-scheme) for the page.

    Args:
        page: Playwright or Selenium page/driver object.
        engine: Engine type: 'playwright' or 'selenium'.
        color_scheme: Color scheme to emulate: 'light', 'dark', 'no-preference', or None to reset.

    Raises:
        ValueError: If page or engine is not provided, or if color_scheme is invalid.
        ValueError: If the engine is not supported.
    """
    if page is None:
        msg = "page is required in emulate_media"
        raise ValueError(msg)
    if not engine:
        msg = "engine is required in emulate_media"
        raise ValueError(msg)

    if color_scheme is not None and color_scheme not in VALID_COLOR_SCHEMES:
        msg = (
            f'Invalid color_scheme: "{color_scheme}". '
            f"Expected one of: {', '.join(VALID_COLOR_SCHEMES)}, or None"
        )
        raise ValueError(msg)

    if engine == "playwright":
        # Playwright supports emulate_media natively
        media_options: dict[str, Any] = {}
        if color_scheme is not None:
            media_options["color_scheme"] = color_scheme
        await page.emulate_media(**media_options)

    elif engine == "selenium":
        # Selenium uses Chrome DevTools Protocol (CDP) for media emulation
        if color_scheme is None:
            # Reset to default (empty string resets the emulation)
            page.execute_cdp_cmd(
                "Emulation.setEmulatedMedia",
                {
                    "features": [
                        {"name": "prefers-color-scheme", "value": ""},
                    ]
                },
            )
        else:
            page.execute_cdp_cmd(
                "Emulation.setEmulatedMedia",
                {
                    "features": [
                        {"name": "prefers-color-scheme", "value": color_scheme},
                    ]
                },
            )

    else:
        msg = f"Unsupported engine: {engine}. Expected 'playwright' or 'selenium'"
        raise ValueError(msg)
