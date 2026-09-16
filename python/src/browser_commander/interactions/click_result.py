"""Truthful result model for click operations.

The old model answered every click with two booleans, and both of them were
optimistic: a button that did nothing still reported ``verified=True``. This
model separates three questions that used to be conflated - did we dispatch the
click, did the page react, and how did the operation end - and records the
evidence behind each answer.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field
from typing import Any


class ClickStatus:
    """How a click operation ended."""

    #: Click dispatched and its effect was confirmed.
    SUCCEEDED = "succeeded"
    #: Click could not be dispatched, or dispatch provably failed.
    FAILED = "failed"
    #: The operation ran out of its budget.
    TIMED_OUT = "timed_out"
    #: Navigation or an explicit stop cut the operation short.
    INTERRUPTED = "interrupted"
    #: Click dispatched, but nothing confirmed or denied that it had an effect.
    UNVERIFIED = "unverified"


class ClickEffect:
    """What the page did in response to the click."""

    #: Observed evidence that the click did something.
    CONFIRMED = "confirmed"
    #: No evidence either way.
    NOT_OBSERVED = "not-observed"
    #: Observed evidence that the click did NOT do what was expected.
    CONTRADICTED = "contradicted"


@dataclass
class Evidence:
    """One observation supporting a click or readiness decision."""

    type: str
    detail: dict[str, Any] = field(default_factory=dict)


def evidence(type: str, **detail: Any) -> Evidence:
    """Build one piece of evidence.

    Args:
        type: Evidence kind, e.g. ``element-state`` or ``navigation``
        **detail: Arbitrary structured detail

    Returns:
        Evidence entry
    """
    return Evidence(type=type, detail=detail)


@dataclass
class ClickVerificationResult:
    """Outcome of verifying that a click had an effect."""

    verified: bool
    reason: str
    #: ``None`` means the verifier predates the effect vocabulary; the caller
    #: derives it from :attr:`verified`.
    effect: str | None = None
    navigation_error: bool = False
    #: True when the budget ran out before anything could be observed.
    timed_out: bool = False
    evidence: list[Evidence] = field(default_factory=list)

    def resolved_effect(self) -> str:
        """Effect, derived from :attr:`verified` when the verifier omitted it.

        Returns:
            One of :class:`ClickEffect`
        """
        if self.effect is not None:
            return self.effect
        return ClickEffect.CONFIRMED if self.verified else ClickEffect.NOT_OBSERVED


@dataclass
class ClickResult:
    """Result of a click operation.

    ``clicked`` and ``verified`` are retained for callers written against the
    previous contract, but they are now *derived* from what was observed rather
    than from "nothing went wrong": ``verified`` is true only when the effect
    was confirmed.
    """

    status: str
    dispatched: bool = False
    effect: str = ClickEffect.NOT_OBSERVED
    reason: str = ""
    navigated: bool = False
    elapsed_ms: int = 0
    action_id: str | None = None
    navigation_error: bool = False
    evidence: list[Evidence] = field(default_factory=list)

    @property
    def clicked(self) -> bool:
        """Whether the click reached the element."""
        return self.dispatched

    @property
    def verified(self) -> bool:
        """Whether the click's effect was actually observed."""
        return self.effect == ClickEffect.CONFIRMED


def next_action_id() -> str:
    """Mint a correlation ID so navigation evidence can be tied to one click.

    The random half comes from the system CSPRNG. The ID is only a correlation
    key, but it travels into logs and trace bundles, where a reader cannot tell
    a correlation key from a token; ``secrets`` costs nothing and settles the
    question.

    Returns:
        Opaque action ID
    """
    stamp = f"{int(time.time() * 1000):x}"
    suffix = secrets.token_hex(3)
    return f"click-{stamp}-{suffix}"
