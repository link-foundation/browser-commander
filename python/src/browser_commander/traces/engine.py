"""How the recorder talks to each engine (issue #108).

The recorder runs the in-page capture functions from ``assets.json`` (the same
JavaScript source the JavaScript recorder runs) and listens to page events.
Engines differ in how they do both, so the differences live here:

- **Playwright** (async API) evaluates a function source with an argument,
  installs init scripts, exposes frames and emits page events through
  ``page.on``. Its Python objects use properties (``dialog.type``,
  ``request.url``) where JavaScript uses methods, which :func:`read_property`
  smooths over.
- **Selenium** evaluates through ``execute_script`` in the top document only,
  has no page events, and installs init scripts only where the driver speaks
  CDP (``execute_cdp_cmd``, as Chromium drivers do). Events Selenium cannot
  deliver - console messages, page errors, failed requests and frame
  navigations - are not recorded for it.
"""

from __future__ import annotations

import asyncio
import functools
import inspect
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Callable

from .jsonfmt import dumps, js_number


def read_property(subject: Any, name: str) -> Any:
    """Read a property that JavaScript exposes as a method and Python may not.

    Playwright's Python objects turn most getters into properties
    (``dialog.type``) while test doubles and other engines keep them as
    methods (``dialog.type()``). Mappings are read by key.

    Args:
        subject: Object or mapping to read
        name: Attribute or key name

    Returns:
        The value, called when it is a method; None when it is absent
    """
    if subject is None:
        return None
    if isinstance(subject, Mapping):
        return subject.get(name)
    value = getattr(subject, name, None)
    if callable(value) and not isinstance(value, type):
        return value()
    return value


def read_first(subject: Any, *names: str) -> Any:
    """Read the first of several names that is present and not None.

    Args:
        subject: Object or mapping to read
        *names: Candidate names, such as a camelCase and a snake_case spelling

    Returns:
        The first value that is not None, or None
    """
    for name in names:
        try:
            value = read_property(subject, name)
        except Exception:
            continue
        if value is not None:
            return value
    return None


async def settle(value: Any) -> Any:
    """Await a value if it is awaitable, so sync and async engines look alike."""
    if inspect.isawaitable(value):
        return await value
    return value


async def with_deadline(work: Any, timeout_ms: float | None, what: str) -> Any:
    """Bound how long a capture may take.

    Args:
        work: Awaitable to wait for
        timeout_ms: Milliseconds to allow, or a falsy value for no limit
        what: What is being waited for, used in the error message

    Returns:
        What ``work`` resolved to

    Raises:
        TimeoutError: With the message the JavaScript recorder uses
    """
    if not timeout_ms:
        return await settle(work)
    try:
        return await asyncio.wait_for(settle(work), timeout_ms / 1000)
    except asyncio.TimeoutError as error:
        raise TimeoutError(
            f"{what} timed out after {js_number(timeout_ms)}ms"
        ) from error


def is_selenium(page: Any, engine: str | None = None) -> bool:
    """Tell whether ``page`` is a Selenium WebDriver."""
    if engine == "selenium":
        return True
    if engine == "playwright":
        return False
    return callable(getattr(page, "execute_script", None)) and not callable(
        getattr(page, "evaluate", None)
    )


def call_source(source: str, arg: Any) -> str:
    """Build a script that calls a function source with a JSON argument.

    This is what Playwright's ``addInitScript(fn, arg)`` does with a function.

    Args:
        source: Function source from ``assets.json``
        arg: JSON-compatible argument

    Returns:
        Script text
    """
    return f"({source})({dumps(arg)})"


class EngineDriver:
    """Evaluate, listen and capture on one page, whatever the engine."""

    def __init__(self, page: Any, engine: str | None = None) -> None:
        self.page = page
        self.selenium = is_selenium(page, engine)

    async def evaluate(self, source: str, arg: Any, target: Any = None) -> Any:
        """Call a function source with one argument in the page or a frame."""
        subject = self.page if target is None else target
        if self.selenium:
            script = f"return ({source}).apply(null, arguments);"
            return await settle(subject.execute_script(script, arg))
        return await settle(subject.evaluate(source, arg))

    def frames(self) -> list[Any]:
        """The page's frames, or an empty list when they cannot be listed."""
        if self.selenium:
            return []
        try:
            return list(read_property(self.page, "frames") or [])
        except Exception:
            # A page that closed mid-drain has no frames, which is not an error.
            return []

    async def screenshot(self) -> bytes:
        """Take a PNG screenshot of the page."""
        if self.selenium:
            return await settle(self.page.get_screenshot_as_png())
        return await settle(self.page.screenshot(type="png"))

    async def install_init_script(
        self,
        source: str,
        arg: Any,
        note: Callable[[str], None] | None = None,
    ) -> Callable[[], Any] | None:
        """Run a function in every document the page loads from now on.

        Args:
            source: Function source from ``assets.json``
            arg: Its argument
            note: Where to report a removal that failed

        Returns:
            A function that removes the script, or None when the engine
            cannot install one
        """
        page = self.page
        script = call_source(source, arg)
        add = getattr(page, "add_init_script", None) or getattr(
            page, "addInitScript", None
        )
        if not self.selenium and callable(add):
            await settle(add(script=script) if _accepts(add, "script") else add(script))
            return lambda: None
        cdp = getattr(page, "execute_cdp_cmd", None)
        if self.selenium and callable(cdp):
            handle = await settle(
                cdp("Page.addScriptToEvaluateOnNewDocument", {"source": script})
            )
            identifier = (handle or {}).get("identifier")

            def remove() -> None:
                if identifier is None:
                    return
                try:
                    cdp(
                        "Page.removeScriptToEvaluateOnNewDocument",
                        {"identifier": identifier},
                    )
                except Exception as error:
                    if note:
                        note(f"could not remove the init script: {error}")

            return remove
        return None

    def subscribe(self, event: str, listener: Callable[..., Any]) -> Callable[[], None]:
        """Listen to a page event.

        Args:
            event: Event name, such as ``console``
            listener: Called with the event's payload

        Returns:
            A function that stops listening

        Raises:
            RuntimeError: When the engine has no page events
        """
        page = self.page
        on = getattr(page, "on", None)
        if self.selenium or not callable(on):
            raise RuntimeError(f"the page does not emit {event} events")
        on(event, listener)

        def detach() -> None:
            for name in ("remove_listener", "off"):
                off = getattr(page, name, None)
                if callable(off):
                    off(event, listener)
                    return

        return detach


def _accepts(function: Callable[..., Any], keyword: str) -> bool:
    try:
        return keyword in inspect.signature(function).parameters
    except (TypeError, ValueError):
        return False


def error_message(error: BaseException | Any) -> str:
    """The message of an error, as ``error.message ?? String(error)`` reads it."""
    message = getattr(error, "message", None)
    if isinstance(message, str):
        return message
    return str(error)


@functools.lru_cache(maxsize=1)
def load_assets() -> dict[str, Any]:
    """Load the in-page code and viewer assets generated from the JavaScript.

    ``assets.json`` is written by ``scripts/generate-trace-assets.mjs`` from
    ``js/src/traces``, so every recorder runs the same capture code in the page
    and writes the same viewer.

    Returns:
        The parsed assets
    """
    path = Path(__file__).with_name("assets.json")
    return json.loads(path.read_text(encoding="utf-8"))
