"""What a click is allowed to claim it did.

Split out of :mod:`browser_commander.interactions.click` so the dispatch half
and the observation half can be read separately: this module never clicks
anything, it only reads the page and decides what was actually observed.

The rule the whole module follows is that an element which is still present and
unchanged after a click is not evidence that the click did anything - that is
exactly the case of a button whose handler is missing or threw - so it is
reported as ``not-observed`` rather than as success.
"""

from __future__ import annotations

from typing import Any, Callable

from browser_commander.core.engine_adapter import create_engine_adapter
from browser_commander.core.engine_detection import EngineType
from browser_commander.core.logger import Logger
from browser_commander.core.navigation_safety import is_navigation_error
from browser_commander.core.page_trigger_manager import is_action_stopped_error
from browser_commander.core.readiness import Deadline, run_within_deadline
from browser_commander.interactions.click_result import (
    ClickEffect,
    ClickVerificationResult,
    evidence,
)

__all__ = [
    "capture_pre_click_state",
    "default_click_verification",
    "is_interrupted",
    "verify_click",
]

_ELEMENT_STATE_JS = """
(el) => ({
    disabled: el.disabled,
    ariaPressed: el.getAttribute('aria-pressed'),
    ariaExpanded: el.getAttribute('aria-expanded'),
    ariaSelected: el.getAttribute('aria-selected'),
    checked: el.checked,
    className: el.className,
    isConnected: el.isConnected,
})
"""

_OBSERVED_STATE_KEYS = (
    ("ariaPressed", "aria-pressed changed"),
    ("ariaExpanded", "aria-expanded changed"),
    ("ariaSelected", "aria-selected changed"),
    ("checked", "checked state changed"),
    ("className", "className changed"),
    ("disabled", "disabled state changed"),
)


def is_interrupted(error: Exception) -> bool:
    """Whether an error means the page moved out from under the action.

    Args:
        error: Error raised while acting on the page

    Returns:
        True when the action was interrupted, not broken
    """
    return is_navigation_error(error) or is_action_stopped_error(error)


def _timed_out_verdict(deadline: Deadline | None, what: str) -> ClickVerificationResult:
    """Build a verdict for verification that ran out of budget.

    Nothing was observed, so nothing is claimed - only that time, rather than
    the click, is what ended the attempt.

    Args:
        deadline: Deadline the click shared
        what: What the budget expired before, e.g. 'the element could be read'

    Returns:
        A ``not-observed`` verdict carrying timeout evidence
    """
    return ClickVerificationResult(
        verified=False,
        timed_out=True,
        effect=ClickEffect.NOT_OBSERVED,
        reason=f"verification budget expired before {what}",
        evidence=[
            evidence(
                "verification-timeout",
                timeout_ms=deadline.timeout_ms if deadline else None,
                elapsed_ms=deadline.elapsed_ms() if deadline else None,
            )
        ],
    )


async def _probe_element_state(
    page: Any,
    engine: EngineType,
    locator_or_element: Any,
    adapter: Any | None,
    deadline: Deadline | None,
) -> Any:
    """Read the target element's observable state under the click's own budget.

    The engine's locator timeout is far longer than a click's - Playwright waits
    30 seconds for an element a navigation already took away - so the budget the
    caller asked for has to bound the probe.

    Args:
        page: Browser page object
        engine: Engine type
        locator_or_element: Element to read
        adapter: Engine adapter (optional)
        deadline: Deadline the whole click shares

    Returns:
        A ``DeadlineOutcome`` holding the element state, or its expiry
    """
    resolved = adapter if adapter is not None else create_engine_adapter(page, engine)

    return await run_within_deadline(
        deadline,
        lambda: resolved.evaluate_on_element(locator_or_element, _ELEMENT_STATE_JS),
    )


async def default_click_verification(
    page: Any,
    engine: EngineType,
    locator_or_element: Any,
    pre_click_state: dict | None = None,
    adapter: Any | None = None,
    deadline: Deadline | None = None,
) -> ClickVerificationResult:
    """Default verification function for click operations.

    Reports what it observed and nothing more:

    - a change to a tracked element property confirms an effect;
    - removal from the DOM confirms an effect;
    - anything else is ``not-observed``, including a destroyed execution
      context, which is consistent with the click having navigated the page but
      equally consistent with an unrelated navigation already in flight.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        locator_or_element: Element that was clicked
        pre_click_state: State captured before click (optional)
        adapter: Engine adapter (optional)

    Returns:
        ClickVerificationResult
    """
    try:
        probe = await _probe_element_state(
            page, engine, locator_or_element, adapter, deadline
        )
        if probe.timed_out:
            return _timed_out_verdict(deadline, "the element could be read")

        post_click_state = probe.value
        has_pre_state = bool(pre_click_state)

        if has_pre_state:
            for key, reason in _OBSERVED_STATE_KEYS:
                before = pre_click_state.get(key)
                after = post_click_state.get(key)
                if before != after:
                    return ClickVerificationResult(
                        verified=True,
                        effect=ClickEffect.CONFIRMED,
                        reason=reason,
                        evidence=[
                            evidence(
                                "element-state", key=key, before=before, after=after
                            )
                        ],
                    )

        if not post_click_state.get("isConnected"):
            # Detachment is a real, observable change in the document.
            return ClickVerificationResult(
                verified=True,
                effect=ClickEffect.CONFIRMED,
                reason="element removed from DOM (UI updated)",
                evidence=[evidence("element-state", key="isConnected", after=False)],
            )

        return ClickVerificationResult(
            verified=False,
            effect=ClickEffect.NOT_OBSERVED,
            reason=(
                "no observable change to the target element after the click"
                if has_pre_state
                else "no pre-click state captured, so no change could be observed"
            ),
            evidence=[
                evidence("element-state", unchanged=True, has_pre_state=has_pre_state)
            ],
        )

    except Exception as error:
        if is_interrupted(error):
            return ClickVerificationResult(
                verified=False,
                effect=ClickEffect.NOT_OBSERVED,
                reason=(
                    "verification unavailable: execution context was destroyed "
                    "during verification"
                ),
                navigation_error=True,
                evidence=[evidence("verification-unavailable", message=str(error))],
            )
        raise


async def capture_pre_click_state(
    page: Any,
    engine: EngineType,
    locator_or_element: Any,
    adapter: Any | None = None,
    deadline: Deadline | None = None,
) -> dict:
    """Capture element state before click for verification.

    Args:
        page: Browser page object
        engine: Engine type
        locator_or_element: Element to capture state from
        adapter: Engine adapter (optional)
        deadline: Deadline the whole click shares

    Returns:
        Pre-click state dict, empty when it could not be read in time
    """
    try:
        probe = await _probe_element_state(
            page, engine, locator_or_element, adapter, deadline
        )
        # A state that could not be read in time is no state at all; the click
        # then has nothing to compare against and says so rather than guessing.
        return {} if probe.timed_out else probe.value
    except Exception as error:
        if is_interrupted(error):
            return {}
        raise


async def verify_click(
    page: Any,
    engine: EngineType,
    locator_or_element: Any,
    pre_click_state: dict | None = None,
    verify_fn: Callable | None = None,
    log: Logger | None = None,
    adapter: Any | None = None,
    deadline: Deadline | None = None,
) -> ClickVerificationResult:
    """Verify click operation.

    Args:
        page: Browser page object
        engine: Engine type
        locator_or_element: Element that was clicked
        pre_click_state: State captured before click
        verify_fn: Custom verification function (optional)
        log: Logger instance
        adapter: Engine adapter (optional)
        deadline: Deadline the whole click shares

    Returns:
        ClickVerificationResult with ``effect`` resolved
    """
    if pre_click_state is None:
        pre_click_state = {}

    # Only the built-in verifier is told about the deadline and the adapter;
    # a custom verifier keeps the signature it was written against and is
    # bounded from the outside instead.
    extra: dict[str, Any] = {}
    if verify_fn is None:
        verify_fn = default_click_verification
        extra = {"adapter": adapter, "deadline": deadline}

    outcome = await run_within_deadline(
        deadline,
        lambda: verify_fn(
            page=page,
            engine=engine,
            locator_or_element=locator_or_element,
            pre_click_state=pre_click_state,
            **extra,
        ),
    )

    if outcome.timed_out:
        if log:
            log.debug(lambda: "Click verification ran out of time")
        return _timed_out_verdict(deadline, "an effect could be observed")

    result = outcome.value

    # Custom verifiers predate the effect vocabulary, so map their boolean.
    result.effect = result.resolved_effect()

    if log:
        if result.effect == ClickEffect.CONFIRMED:
            log.debug(lambda: f"Click effect confirmed: {result.reason}")
        else:
            log.debug(
                lambda: f"Click effect {result.effect}: {result.reason or 'unknown'}"
            )

    return result
