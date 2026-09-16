"""Orthogonal click activation options.

``no_auto_scroll=True`` used to be translated into Playwright's ``force=True``,
which skips actionability checks but still scrolls the element into view. The
option therefore promised something the engine never delivered. These three axes
are independent and each one means exactly what it says:

- ``activation``: how the click is delivered (``pointer`` | ``dom``)
- ``scroll``: what may happen to the scroll position
  (``auto`` | ``preserve`` | ``none``)
- ``actionability``: whether engine pre-checks are skipped
  (``normal`` | ``force``)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from browser_commander.core.logger import Logger


class ClickActivation:
    """How the click is delivered to the element."""

    #: Real pointer input at the element's click point.
    POINTER = "pointer"
    #: ``HTMLElement.click()`` - an untrusted event that skips pointer handlers.
    DOM = "dom"


class ClickScroll:
    """What the click is allowed to do to the scroll position."""

    #: Let the engine scroll the element into view (default).
    AUTO = "auto"
    #: Allow scrolling, then restore the original scroll position.
    PRESERVE = "preserve"
    #: Never scroll; fail if the click cannot be delivered without scrolling.
    NONE = "none"


class ClickActionability:
    """Whether the engine's actionability pre-checks run."""

    NORMAL = "normal"
    #: Skip engine pre-checks. Does NOT disable scrolling.
    FORCE = "force"


class ScrollConstraintError(Exception):
    """Raised when ``scroll='none'`` cannot be honored.

    Failing loudly is the point: the previous behavior scrolled anyway and
    reported success, so callers who needed the viewport to stay put had no way
    to find out that it had moved.
    """

    def __init__(self, message: str, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.detail = detail or {}


@dataclass
class ActivationOptions:
    """Resolved activation options."""

    activation: str = ClickActivation.POINTER
    scroll: str = ClickScroll.AUTO
    actionability: str = ClickActionability.NORMAL
    deprecations: list[str] = field(default_factory=list)


@dataclass
class DispatchDetail:
    """What the dispatch actually did."""

    mode: str
    scroll_before: dict[str, float] | None = None
    scroll_after: dict[str, float] | None = None
    point: dict[str, Any] | None = None


_NO_AUTO_SCROLL_DEPRECATION = (
    'no_auto_scroll is deprecated; use scroll="none" (no scrolling at all) '
    'or actionability="force" (skip engine pre-checks, scrolling still allowed)'
)

_ALLOWED = {
    "activation": (ClickActivation.POINTER, ClickActivation.DOM),
    "scroll": (ClickScroll.AUTO, ClickScroll.PRESERVE, ClickScroll.NONE),
    "actionability": (ClickActionability.NORMAL, ClickActionability.FORCE),
}


def _assert_one_of(name: str, value: str) -> None:
    allowed = _ALLOWED[name]
    if value not in allowed:
        options = ", ".join(f"'{item}'" for item in allowed)
        raise ValueError(f"{name} must be one of {options}, got '{value}'")


def resolve_activation_options(
    activation: str | None = None,
    scroll: str | None = None,
    actionability: str | None = None,
    no_auto_scroll: bool | None = None,
    log: Logger | None = None,
) -> ActivationOptions:
    """Resolve activation options, applying the ``no_auto_scroll`` mapping.

    Args:
        activation: Activation mode
        scroll: Scroll policy
        actionability: Actionability policy
        no_auto_scroll: Deprecated alias for ``scroll='none'``
        log: Logger used for the deprecation notice

    Returns:
        Resolved options
    """
    deprecations: list[str] = []
    resolved_scroll = scroll

    if no_auto_scroll is not None:
        deprecations.append(_NO_AUTO_SCROLL_DEPRECATION)
        if resolved_scroll is None:
            resolved_scroll = ClickScroll.NONE if no_auto_scroll else ClickScroll.AUTO

    resolved = ActivationOptions(
        activation=activation or ClickActivation.POINTER,
        scroll=resolved_scroll or ClickScroll.AUTO,
        actionability=actionability or ClickActionability.NORMAL,
        deprecations=deprecations,
    )

    _assert_one_of("activation", resolved.activation)
    _assert_one_of("scroll", resolved.scroll)
    _assert_one_of("actionability", resolved.actionability)

    if deprecations and log:
        for message in deprecations:
            log.debug(lambda message=message: f"WARNING: {message}")

    return resolved


_CLICK_POINT_JS = """
(el) => {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const inViewport = rect.width > 0 && rect.height > 0 &&
        x >= 0 && y >= 0 &&
        x <= window.innerWidth && y <= window.innerHeight;
    const hit = inViewport ? document.elementFromPoint(x, y) : null;
    return {
        x, y,
        width: rect.width, height: rect.height,
        top: rect.top, left: rect.left,
        viewport: {width: window.innerWidth, height: window.innerHeight},
        scroll: {x: window.scrollX, y: window.scrollY},
        inViewport,
        hitsTarget: Boolean(hit && (hit === el || el.contains(hit))),
    };
}
"""

_DOM_CLICK_JS = "(el) => el.click()"

_READ_SCROLL_JS = "() => ({x: window.scrollX, y: window.scrollY})"

_RESTORE_SCROLL_JS = "(pos) => window.scrollTo(pos.x, pos.y)"


async def measure_click_point(
    adapter: Any,
    locator_or_element: Any,
) -> dict[str, Any]:
    """Measure an element's click point and whether it is reachable right now.

    Args:
        adapter: Engine adapter
        locator_or_element: Element or locator

    Returns:
        Geometry and hit-test result
    """
    return await adapter.evaluate_on_element(locator_or_element, _CLICK_POINT_JS)


async def read_scroll_position(adapter: Any) -> dict[str, float] | None:
    """Read the current window scroll position.

    Args:
        adapter: Engine adapter

    Returns:
        Scroll offsets, or ``None`` when they cannot be read
    """
    if not hasattr(adapter, "evaluate_on_page"):
        return None
    try:
        return await adapter.evaluate_on_page(_READ_SCROLL_JS)
    except Exception:
        # Scroll position is evidence, not a precondition - never fail a click
        # because we could not read it.
        return None


async def restore_scroll_position(
    adapter: Any,
    position: dict[str, float] | None,
) -> None:
    """Restore a previously captured scroll position.

    Args:
        adapter: Engine adapter
        position: Position to restore
    """
    if not position or not hasattr(adapter, "evaluate_on_page"):
        return
    await adapter.evaluate_on_page(_RESTORE_SCROLL_JS, position)


def _mouse_of(page: Any) -> Any:
    mouse = getattr(page, "mouse", None)
    if mouse is None or not hasattr(mouse, "click"):
        raise ScrollConstraintError(
            'scroll="none" needs viewport-coordinate pointer input, which this '
            'engine does not expose. Use scroll="preserve" to scroll and '
            'restore, or activation="dom" to dispatch an untrusted click.',
            {"reason": "engine has no pointer API"},
        )
    return mouse


async def _dispatch_pointer_without_scrolling(
    page: Any,
    adapter: Any,
    locator_or_element: Any,
    log: Logger | None,
) -> DispatchDetail:
    mouse = _mouse_of(page)
    point = await measure_click_point(adapter, locator_or_element)

    if not point.get("inViewport"):
        raise ScrollConstraintError(
            'scroll="none" was requested but the element is outside the '
            "viewport, so a real pointer click cannot reach it without "
            'scrolling. Use scroll="preserve" to scroll and restore, '
            'scroll="auto" to allow scrolling, or activation="dom" to '
            "dispatch an untrusted click.",
            point,
        )

    if not point.get("hitsTarget"):
        raise ScrollConstraintError(
            'scroll="none" was requested but another element covers the target '
            "at its click point, so a real pointer click would hit the wrong "
            "element.",
            point,
        )

    if log:
        log.debug(
            lambda: (
                f"Pointer click at ({point['x']:.0f}, {point['y']:.0f}) "
                "without scrolling"
            )
        )

    scroll_before = dict(point["scroll"])
    await mouse.click(point["x"], point["y"])

    return DispatchDetail(
        mode=ClickActivation.POINTER,
        scroll_before=scroll_before,
        scroll_after=await read_scroll_position(adapter),
        point=point,
    )


async def dispatch_click(
    page: Any,
    adapter: Any,
    locator_or_element: Any,
    activation_options: ActivationOptions,
    log: Logger | None = None,
) -> DispatchDetail:
    """Deliver a click according to the resolved activation options.

    Args:
        page: Browser page object
        adapter: Engine adapter
        locator_or_element: Element or locator to click
        activation_options: Result of :func:`resolve_activation_options`
        log: Logger instance

    Returns:
        What the dispatch did

    Raises:
        ScrollConstraintError: When ``scroll='none'`` cannot be honored
    """
    if activation_options.activation == ClickActivation.DOM:
        if log:
            log.debug(
                lambda: (
                    "Dispatching DOM activation (HTMLElement.click(); "
                    "untrusted event, no scrolling)"
                )
            )
        scroll_before = await read_scroll_position(adapter)
        await adapter.evaluate_on_element(locator_or_element, _DOM_CLICK_JS)
        return DispatchDetail(
            mode=ClickActivation.DOM,
            scroll_before=scroll_before,
            scroll_after=await read_scroll_position(adapter),
        )

    if activation_options.scroll == ClickScroll.NONE:
        return await _dispatch_pointer_without_scrolling(
            page=page,
            adapter=adapter,
            locator_or_element=locator_or_element,
            log=log,
        )

    scroll_before = await read_scroll_position(adapter)
    force = activation_options.actionability == ClickActionability.FORCE
    await adapter.click(locator_or_element, force=force)

    if activation_options.scroll == ClickScroll.PRESERVE:
        await restore_scroll_position(adapter, scroll_before)

    return DispatchDetail(
        mode=ClickActivation.POINTER,
        scroll_before=scroll_before,
        scroll_after=await read_scroll_position(adapter),
    )
