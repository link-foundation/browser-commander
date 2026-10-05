"""Translate the common PDF options to WebDriver Print Page (#124)."""

from __future__ import annotations

import base64
import re
from pathlib import Path
from typing import Any

# WebDriver measures paper and margins in centimetres.
_PAPER_CM = {
    "letter": (21.59, 27.94),
    "legal": (21.59, 35.56),
    "tabloid": (27.94, 43.18),
    "ledger": (43.18, 27.94),
    "a0": (84.1, 118.9),
    "a1": (59.4, 84.1),
    "a2": (42.0, 59.4),
    "a3": (29.7, 42.0),
    "a4": (21.0, 29.7),
    "a5": (14.8, 21.0),
    "a6": (10.5, 14.8),
}
_UNITS = {"px": 2.54 / 96, "in": 2.54, "cm": 1, "mm": 0.1}


def _centimetres(value: str | float) -> float:
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(px|in|cm|mm)?\s*", str(value))
    if match is None:
        raise ValueError(f"Invalid PDF length: {value}")
    return float(match[1]) * _UNITS[match[2] or "px"]


def webdriver_pdf(driver: Any, options: dict[str, Any]) -> bytes:
    """Print natively, rejecting options the WebDriver protocol cannot express."""
    from selenium.webdriver.common.print_page_options import PrintOptions

    supported = {
        "format",
        "width",
        "height",
        "margin",
        "landscape",
        "scale",
        "print_background",
        "page_ranges",
        "path",
    }
    unsupported = [
        name for name, value in options.items() if name not in supported and value
    ]
    if unsupported:
        raise ValueError(
            f"WebDriver Print Page does not support {', '.join(unsupported)} (webdriver-print-options)"
        )
    print_options = PrintOptions()
    if options.get("format"):
        size = _PAPER_CM.get(str(options["format"]).lower())
        if size is None:
            raise ValueError(f"Unknown paper format: {options['format']}")
        print_options.page_width, print_options.page_height = size
    for name in ("width", "height"):
        if name in options:
            setattr(print_options, f"page_{name}", _centimetres(options[name]))
    for side, value in options.get("margin", {}).items():
        if side not in {"top", "bottom", "left", "right"}:
            raise ValueError(f"Unknown PDF margin: {side}")
        setattr(print_options, f"margin_{side}", _centimetres(value))
    if "landscape" in options:
        print_options.orientation = "landscape" if options["landscape"] else "portrait"
    if "scale" in options:
        print_options.scale = options["scale"]
    if "print_background" in options:
        print_options.background = options["print_background"]
    if "page_ranges" in options:
        print_options.page_ranges = [
            part.strip() for part in options["page_ranges"].split(",") if part.strip()
        ]
    result = base64.b64decode(driver.print_page(print_options), validate=True)
    if options.get("path"):
        Path(options["path"]).write_bytes(result)
    return result
