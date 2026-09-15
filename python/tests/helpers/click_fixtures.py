"""Shared fixtures for the click tests.

The activation tests and the ``click_element`` tests exercise the same two
shapes - an element state probe result and a click-point probe result - so they
live here instead of drifting apart in two files.
"""

from __future__ import annotations

from typing import Any, Callable

#: State of a plain, enabled button that nothing has changed.
UNCHANGED_STATE: dict[str, Any] = {
    "disabled": False,
    "ariaPressed": "false",
    "ariaExpanded": None,
    "ariaSelected": None,
    "checked": False,
    "className": "btn",
    "isConnected": True,
}

#: Click-point probe result for an element fully inside the viewport.
IN_VIEWPORT_POINT: dict[str, Any] = {
    "x": 50,
    "y": 60,
    "width": 100,
    "height": 40,
    "top": 40,
    "left": 0,
    "viewport": {"width": 800, "height": 600},
    "scroll": {"x": 0, "y": 0},
    "inViewport": True,
    "hitsTarget": True,
}

#: Click-point probe result for an element far below the fold.
OFF_SCREEN_POINT: dict[str, Any] = {
    **IN_VIEWPORT_POINT,
    "y": 4000,
    "top": 3980,
    "inViewport": False,
    "hitsTarget": False,
}


class ScrollModel:
    """A mutable window scroll position with the ``evaluate_on_page`` contract.

    No argument reads the position; an argument writes it.
    """

    def __init__(self, initial: float = 0) -> None:
        self.y = initial

    async def evaluate_on_page(self, fn: Callable, arg: Any = None) -> Any:
        """Read or write the modelled scroll position.

        Args:
            fn: Ignored; the page function the caller would have run
            arg: Position to write, or ``None`` to read

        Returns:
            The current position when reading, otherwise ``None``
        """
        if arg is not None:
            self.y = arg["y"]
            return None
        return {"x": 0, "y": self.y}
