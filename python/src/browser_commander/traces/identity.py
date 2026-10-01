"""Stable identifiers for what a trace records (issue #108).

A port of ``js/src/traces/identity.js``. Every record names the trace, browser
context, page and navigation it belongs to, so records from several pages or
several navigations of one page can be told apart. Contexts and pages are
numbered the first time any trace sees them and keep their number for every
later trace in the same process.
"""

from __future__ import annotations

import weakref
from typing import Any

from .engine import read_property

_counters = {"context": 0, "page": 0, "trace": 0}
_assigned: weakref.WeakKeyDictionary[Any, str] = weakref.WeakKeyDictionary()
# Objects that cannot be weakly referenced are remembered by identity, and the
# object is kept with its id so the id is never reused by another object.
_assigned_strong: dict[int, tuple[Any, str]] = {}


def _reset_identity_counters() -> None:
    """Forget every assigned identifier. For tests that compare output."""
    for key in _counters:
        _counters[key] = 0
    _assigned.clear()
    _assigned_strong.clear()


def _identify(subject: Any, kind: str, prefix: str) -> str | None:
    if subject is None or isinstance(subject, (str, bytes, int, float, bool)):
        return None
    try:
        existing = _assigned.get(subject)
    except TypeError:
        held = _assigned_strong.get(id(subject))
        existing = held[1] if held else None
    if existing:
        return existing
    _counters[kind] += 1
    assigned = f"{prefix}-{_counters[kind]}"
    try:
        _assigned[subject] = assigned
    except TypeError:
        _assigned_strong[id(subject)] = (subject, assigned)
    return assigned


def browser_context_of(page: Any) -> Any:
    """Find the browser context a page belongs to.

    Args:
        page: Engine page

    Returns:
        The context, or None when the engine has no such notion
    """
    if page is None:
        return None
    for accessor in ("context", "browser_context", "browserContext"):
        try:
            context = read_property(page, accessor)
        except Exception:
            # An engine that closed the page answers by throwing; an unnamed
            # context is better than a failed trace.
            continue
        if context is not None:
            return context
    return None


class TraceIdentity:
    """The identifiers one trace stamps on its records."""

    def __init__(self, page: Any = None) -> None:
        _counters["trace"] += 1
        self.trace_id = f"trace-{_counters['trace']}"
        self.browser_context_id = _identify(
            browser_context_of(page), "context", "context"
        )
        self.page_id = _identify(page, "page", "page")
        # A navigation is what separates "the same element" from "an element
        # with the same path in a different document", so it is numbered from
        # the start rather than from the first navigation the recorder sees.
        self._navigation = 1
        self._actions = 0

    @property
    def navigation_id(self) -> str:
        """The current navigation's identifier."""
        return f"nav-{self._navigation}"

    def navigated(self) -> str:
        """Start a new navigation and return its identifier."""
        self._navigation += 1
        return self.navigation_id

    def next_action_id(self) -> str:
        """Number the next interaction."""
        self._actions += 1
        return f"{self.trace_id}-action-{self._actions}"

    def owner(self) -> dict[str, Any]:
        """The identifiers every record carries."""
        return {
            "traceId": self.trace_id,
            "browserContextId": self.browser_context_id,
            "pageId": self.page_id,
            "navigationId": self.navigation_id,
        }


def create_trace_identity(page: Any = None) -> TraceIdentity:
    """Number a new trace and the page and context it records.

    Args:
        page: Engine page the trace records

    Returns:
        The trace's identity
    """
    return TraceIdentity(page)
