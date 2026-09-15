"""Readiness primitives - one monotonic deadline, composable checks, evidence.

``wait_for_page_ready`` used to answer "is the page ready?" with a hard-coded
sequence of waits and no record of what it actually observed. This module
supplies the pieces that make the answer truthful: a deadline that only ever
hands out non-negative remaining budget, checks that report what they saw, and
a result that distinguishes "ready" from "we ran out of time".
"""

from __future__ import annotations

import asyncio
import math
import re
import time
from collections.abc import Awaitable, Sequence
from dataclasses import dataclass, field
from typing import Any, Callable


class ReadinessStatus:
    """Statuses a readiness wait can end in."""

    #: Every check was satisfied.
    READY = "ready"
    #: The budget ran out before every check could answer.
    TIMED_OUT = "timed_out"
    #: A check reported, within budget, that it was not satisfied.
    FAILED = "failed"


#: Request classes that never go idle on their own. Waiting for them is waiting
#: for the timeout, so network idle ignores them unless a caller opts back in.
LONG_LIVED_REQUEST_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^wss?://", re.IGNORECASE),
    re.compile(r"/(?:socket\.io|sockjs|websocket|ws)(?:[/?]|$)", re.IGNORECASE),
    re.compile(r"/(?:event-?stream|sse|stream)(?:[/?]|$)", re.IGNORECASE),
    re.compile(
        r"(?:^|\.)(?:google-analytics|googletagmanager|doubleclick|segment"
        r"|mixpanel|amplitude|hotjar|sentry|datadoghq|newrelic)\.",
        re.IGNORECASE,
    ),
    re.compile(
        r"/(?:analytics|telemetry|beacon|collect|metrics|heartbeat|ping"
        r"|poll|longpoll)(?:[/?]|$)",
        re.IGNORECASE,
    ),
)


def is_long_lived_request(
    url: str,
    patterns: Sequence[re.Pattern[str]] = LONG_LIVED_REQUEST_PATTERNS,
) -> bool:
    """Report whether a URL belongs to a request class expected to stay open.

    Args:
        url: Request URL
        patterns: Patterns to test, defaults to the built-in list

    Returns:
        Whether idle checks should ignore the request
    """
    if not isinstance(url, str) or not url:
        return False
    return any(pattern.search(url) for pattern in patterns)


class Deadline:
    """A monotonic budget shared by every check in one readiness wait.

    The clock is monotonic on purpose: a wall-clock jump (an NTP correction, a
    suspended laptop) must not turn a five second budget into a five minute one.
    """

    def __init__(
        self,
        timeout: float,
        now: Callable[[], float] | None = None,
    ) -> None:
        """Start a deadline.

        Args:
            timeout: Total budget in milliseconds
            now: Monotonic clock returning seconds, defaults to time.monotonic

        Raises:
            ValueError: When the timeout is negative, infinite, or NaN
        """
        if timeout is None or not math.isfinite(timeout) or timeout < 0:
            raise ValueError("Deadline requires a non-negative finite timeout")

        self._now = now or time.monotonic
        self.started_at = self._now()
        self.timeout_ms = float(timeout)

    def _elapsed(self) -> float:
        return max(0.0, (self._now() - self.started_at) * 1000)

    def elapsed_ms(self) -> int:
        """Milliseconds spent so far.

        Returns:
            Elapsed milliseconds, never negative
        """
        return round(self._elapsed())

    def remaining_ms(self) -> int:
        """Milliseconds left in the budget.

        Returns:
            Remaining milliseconds, never negative
        """
        return max(0, round(self.timeout_ms - self._elapsed()))

    def expired(self) -> bool:
        """Report whether the budget is spent.

        Returns:
            Whether the deadline has passed
        """
        return self._elapsed() >= self.timeout_ms


async def sleep_within_deadline(ms: float, deadline: Deadline) -> None:
    """Sleep for at most the deadline's remaining budget.

    Args:
        ms: Requested delay in milliseconds
        deadline: Deadline to respect
    """
    capped = min(ms, deadline.remaining_ms())
    if capped <= 0:
        return
    await asyncio.sleep(capped / 1000)


@dataclass
class CheckOutcome:
    """What a single readiness check observed."""

    satisfied: bool = False
    skipped: bool = False
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass
class CheckRecord:
    """Evidence for one check that ran."""

    name: str
    satisfied: bool
    skipped: bool
    started_at_ms: int
    elapsed_ms: int
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass
class ReadinessResult:
    """The outcome of a readiness wait, with the evidence behind it."""

    status: str
    ready: bool
    satisfied: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    pending: list[str] = field(default_factory=list)
    evidence: list[CheckRecord] = field(default_factory=list)
    elapsed_ms: int = 0
    timeout_ms: float = 0.0
    reason: str = ""
    url: str = ""


@dataclass
class ReadinessCheck:
    """A named check that reports what it observed."""

    name: str
    run: Callable[[dict[str, Any]], Awaitable[CheckOutcome]]


def _resolve_adapter_factory(context: dict[str, Any]) -> Any:
    adapter = context.get("adapter")
    if adapter is not None:
        return adapter
    get_adapter = context.get("get_adapter")
    if get_adapter is None:
        raise RuntimeError("readiness check requires an engine adapter")
    return get_adapter


async def _resolve_adapter(context: dict[str, Any]) -> Any:
    resolved = _resolve_adapter_factory(context)
    if callable(resolved):
        resolved = resolved()
    if asyncio.iscoroutine(resolved):
        resolved = await resolved
    if resolved is None:
        raise RuntimeError("readiness check requires an engine adapter")
    return resolved


def _normalize_sample(value: Any) -> tuple[bool, dict[str, Any]]:
    if isinstance(value, bool):
        return value, {}
    if isinstance(value, tuple):
        stable, detail = value
        return bool(stable), detail or {}
    return bool(value), {}


def stable_check(
    name: str,
    sample: Callable[[dict[str, Any]], Any],
    stable_for_ms: float = 500,
    interval_ms: float = 100,
    consecutive_samples: int = 1,
) -> ReadinessCheck:
    """Build a check that requires a sampler to report stability for a period.

    Args:
        name: Check name reported in evidence
        sample: Sampler returning ``bool`` or ``(bool, detail)``
        stable_for_ms: How long the sampler must stay stable
        interval_ms: Sampling interval
        consecutive_samples: Extra consecutive stable samples required

    Returns:
        A readiness check
    """

    async def run(context: dict[str, Any]) -> CheckOutcome:
        deadline: Deadline = context["deadline"]
        stable_since: int | None = None
        streak = 0
        last_detail: dict[str, Any] = {}

        while not deadline.expired():
            result = sample(context)
            if asyncio.iscoroutine(result):
                result = await result
            stable, last_detail = _normalize_sample(result)

            if stable:
                streak += 1
                if stable_since is None:
                    stable_since = deadline.elapsed_ms()
                held_for = deadline.elapsed_ms() - stable_since
                if held_for >= stable_for_ms and streak >= consecutive_samples:
                    return CheckOutcome(
                        satisfied=True,
                        detail={**last_detail, "heldForMs": held_for},
                    )
            else:
                stable_since = None
                streak = 0

            if deadline.remaining_ms() == 0:
                break
            await sleep_within_deadline(interval_ms, deadline)

        return CheckOutcome(
            satisfied=False,
            detail={**last_detail, "reason": "deadline reached"},
        )

    return ReadinessCheck(name=name, run=run)


def url_stable_for(
    stable_for_ms: float = 1000,
    interval_ms: float = 200,
    consecutive_samples: int = 1,
) -> ReadinessCheck:
    """Require the page URL to stop changing for a period.

    Args:
        stable_for_ms: Required quiet period
        interval_ms: Sampling interval
        consecutive_samples: Extra consecutive stable samples

    Returns:
        A readiness check
    """
    last_url: list[str | None] = [None]

    def sample(context: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
        url = context["get_url"]()
        on_url_sample = context.get("on_url_sample")
        if on_url_sample:
            on_url_sample(url)
        stable = last_url[0] is not None and url == last_url[0]
        last_url[0] = url
        return stable, {"url": url}

    return stable_check(
        name="url_stable_for",
        sample=sample,
        stable_for_ms=stable_for_ms,
        interval_ms=interval_ms,
        consecutive_samples=consecutive_samples,
    )


def network_idle_for(idle_for_ms: int | None = None) -> ReadinessCheck:
    """Require the network tracker to report idle within the remaining budget.

    Args:
        idle_for_ms: Idle window, defaults to the tracker's own

    Returns:
        A readiness check
    """

    async def run(context: dict[str, Any]) -> CheckOutcome:
        deadline: Deadline = context["deadline"]
        tracker = context.get("network_tracker")

        if tracker is None:
            return CheckOutcome(skipped=True, detail={"reason": "no network tracker"})

        timeout = deadline.remaining_ms()
        if timeout == 0:
            return CheckOutcome(detail={"reason": "no remaining budget"})

        kwargs: dict[str, Any] = {"timeout": timeout}
        if idle_for_ms is not None:
            kwargs["idle_time"] = idle_for_ms
        idle = await tracker.wait_for_network_idle(**kwargs)

        return CheckOutcome(
            satisfied=bool(idle),
            detail={
                "pendingCount": tracker.get_pending_count(),
                "pendingUrls": [] if idle else tracker.get_pending_urls(),
            },
        )

    return ReadinessCheck(name="network_idle_for", run=run)


_DOM_FINGERPRINT_JS = """
() => {
    const body = document.body;
    return {
        nodes: document.getElementsByTagName('*').length,
        length: body ? body.innerHTML.length : 0,
        readyState: document.readyState,
    };
}
"""

_VISIBLE_IMAGES_JS = """
() => {
    const images = [...document.images];
    const inViewport = images.filter((image) => {
        const box = image.getBoundingClientRect();
        return box.bottom > 0 && box.right > 0 &&
            box.top < window.innerHeight && box.left < window.innerWidth;
    });
    return {
        total: inViewport.length,
        pending: inViewport.filter((image) => !image.complete).length,
    };
}
"""


def dom_stable_for(
    stable_for_ms: float = 500,
    interval_ms: float = 100,
    consecutive_samples: int = 2,
) -> ReadinessCheck:
    """Require the DOM to stop mutating for a period.

    Uses a cheap structural fingerprint so it works identically on every engine
    and needs no script injection.

    Args:
        stable_for_ms: Required quiet period
        interval_ms: Sampling interval
        consecutive_samples: Extra consecutive stable samples

    Returns:
        A readiness check
    """
    last_fingerprint: list[str | None] = [None]

    async def sample(context: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
        adapter = await _resolve_adapter(context)
        fingerprint = await adapter.evaluate_on_page(_DOM_FINGERPRINT_JS)
        key = f"{fingerprint['nodes']}:{fingerprint['length']}"
        stable = (
            last_fingerprint[0] == key and fingerprint.get("readyState") != "loading"
        )
        last_fingerprint[0] = key
        return stable, fingerprint

    return stable_check(
        name="dom_stable_for",
        sample=sample,
        stable_for_ms=stable_for_ms,
        interval_ms=interval_ms,
        consecutive_samples=consecutive_samples,
    )


def visible_images(interval_ms: float = 150) -> ReadinessCheck:
    """Require every image currently in the viewport to have finished decoding.

    Args:
        interval_ms: Sampling interval

    Returns:
        A readiness check
    """

    async def sample(context: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
        adapter = await _resolve_adapter(context)
        state = await adapter.evaluate_on_page(_VISIBLE_IMAGES_JS)
        return state["pending"] == 0, state

    return stable_check(
        name="visible_images",
        sample=sample,
        stable_for_ms=0,
        interval_ms=interval_ms,
        consecutive_samples=1,
    )


def predicate(
    fn: Callable[[dict[str, Any]], Any],
    name: str = "predicate",
    interval_ms: float = 100,
) -> ReadinessCheck:
    """Wrap a caller-supplied predicate as a readiness check.

    Args:
        fn: Predicate receiving the check context
        name: Name reported in evidence
        interval_ms: Polling interval

    Returns:
        A readiness check

    Raises:
        TypeError: When ``fn`` is not callable
    """
    if not callable(fn):
        raise TypeError("predicate requires a callable")

    async def sample(context: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
        result = fn(context)
        if asyncio.iscoroutine(result):
            result = await result
        return bool(result), {}

    return stable_check(
        name=name,
        sample=sample,
        stable_for_ms=0,
        interval_ms=interval_ms,
        consecutive_samples=1,
    )


async def run_readiness_checks(
    checks: Sequence[ReadinessCheck],
    deadline: Deadline,
    context: dict[str, Any] | None = None,
) -> ReadinessResult:
    """Run readiness checks in order against one deadline and report evidence.

    Checks run to completion even after one fails, so the result explains the
    whole picture rather than only the first problem. Checks that never started
    are reported as pending, which is what tells a caller the wait was cut short
    rather than genuinely unsatisfied.

    Args:
        checks: Readiness checks to run, in order
        deadline: The single budget shared by every check
        context: Context handed to every check

    Returns:
        The structured readiness result
    """
    result = ReadinessResult(status=ReadinessStatus.READY, ready=True)
    check_context = {**(context or {}), "deadline": deadline}

    for index, check in enumerate(checks):
        if deadline.expired() and result.failed:
            result.pending.extend(entry.name for entry in checks[index:])
            break

        started_at_ms = deadline.elapsed_ms()
        try:
            outcome = await check.run(check_context)
        except Exception as error:
            outcome = CheckOutcome(detail={"error": str(error)})

        record = CheckRecord(
            name=check.name,
            satisfied=bool(outcome.satisfied),
            skipped=bool(outcome.skipped),
            started_at_ms=started_at_ms,
            elapsed_ms=deadline.elapsed_ms() - started_at_ms,
            detail=outcome.detail or {},
        )
        result.evidence.append(record)

        if record.skipped:
            result.skipped.append(check.name)
        elif record.satisfied:
            result.satisfied.append(check.name)
        else:
            result.failed.append(check.name)

    result.ready = not result.failed and not result.pending
    result.elapsed_ms = deadline.elapsed_ms()
    result.timeout_ms = deadline.timeout_ms

    if result.ready:
        result.status = ReadinessStatus.READY
    elif deadline.expired():
        result.status = ReadinessStatus.TIMED_OUT
    else:
        result.status = ReadinessStatus.FAILED

    return result


__all__ = [
    "LONG_LIVED_REQUEST_PATTERNS",
    "CheckOutcome",
    "CheckRecord",
    "Deadline",
    "ReadinessCheck",
    "ReadinessResult",
    "ReadinessStatus",
    "dom_stable_for",
    "is_long_lived_request",
    "network_idle_for",
    "predicate",
    "run_readiness_checks",
    "sleep_within_deadline",
    "stable_check",
    "url_stable_for",
    "visible_images",
]
