"""Click interactions for browser-commander.

This module provides click functions for both Playwright and Selenium engines.

Click results report what was *observed*. An element that is still present and
unchanged after a click is not evidence that the click did anything - that is
exactly the case of a button whose handler is missing or threw - so it is
reported as ``not-observed`` rather than as success.
"""

from __future__ import annotations

import time
from typing import Any, Callable

from browser_commander.core.constants import TIMING
from browser_commander.core.engine_adapter import create_engine_adapter
from browser_commander.core.engine_detection import EngineType
from browser_commander.core.logger import Logger
from browser_commander.core.navigation_safety import is_navigation_error
from browser_commander.core.page_trigger_manager import is_action_stopped_error
from browser_commander.elements.content import log_element_info
from browser_commander.elements.locators import wait_for_locator_or_element
from browser_commander.interactions.click_activation import (
    ActivationOptions,
    ClickActionability,
    ClickActivation,
    ClickScroll,
    ScrollConstraintError,
    dispatch_click,
    resolve_activation_options,
)
from browser_commander.interactions.click_result import (
    ClickEffect,
    ClickResult,
    ClickStatus,
    ClickVerificationResult,
    Evidence,
    evidence,
    next_action_id,
)
from browser_commander.interactions.scroll import scroll_into_view_if_needed

__all__ = [
    # Orthogonal activation options
    "ClickActionability",
    "ClickActivation",
    "ClickEffect",
    "ClickResult",
    "ClickScroll",
    # Truthful click result model
    "ClickStatus",
    "ClickVerificationResult",
    "ScrollConstraintError",
    "capture_pre_click_state",
    "click_button",
    "click_element",
    "default_click_verification",
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


def _is_interrupted(error: Exception) -> bool:
    """Whether an error means the page moved out from under the action.

    Args:
        error: Error raised while acting on the page

    Returns:
        True when the action was interrupted, not broken
    """
    return is_navigation_error(error) or is_action_stopped_error(error)


async def default_click_verification(
    page: Any,
    engine: EngineType,
    locator_or_element: Any,
    pre_click_state: dict | None = None,
    adapter: Any | None = None,
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
        if adapter is None:
            adapter = create_engine_adapter(page, engine)

        post_click_state = await adapter.evaluate_on_element(
            locator_or_element,
            _ELEMENT_STATE_JS,
        )

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
        if _is_interrupted(error):
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
) -> dict:
    """Capture element state before click for verification.

    Args:
        page: Browser page object
        engine: Engine type
        locator_or_element: Element to capture state from
        adapter: Engine adapter (optional)

    Returns:
        Pre-click state dict
    """
    try:
        if adapter is None:
            adapter = create_engine_adapter(page, engine)

        return await adapter.evaluate_on_element(locator_or_element, _ELEMENT_STATE_JS)
    except Exception as error:
        if _is_interrupted(error):
            return {}
        raise


async def verify_click(
    page: Any,
    engine: EngineType,
    locator_or_element: Any,
    pre_click_state: dict | None = None,
    verify_fn: Callable | None = None,
    log: Logger | None = None,
) -> ClickVerificationResult:
    """Verify click operation.

    Args:
        page: Browser page object
        engine: Engine type
        locator_or_element: Element that was clicked
        pre_click_state: State captured before click
        verify_fn: Custom verification function (optional)
        log: Logger instance

    Returns:
        ClickVerificationResult with ``effect`` resolved
    """
    if verify_fn is None:
        verify_fn = default_click_verification
    if pre_click_state is None:
        pre_click_state = {}

    result = await verify_fn(
        page=page,
        engine=engine,
        locator_or_element=locator_or_element,
        pre_click_state=pre_click_state,
    )

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


def _scroll_changed(detail: Any) -> bool | None:
    before, after = detail.scroll_before, detail.scroll_after
    if not before or not after:
        return None
    return before.get("x") != after.get("x") or before.get("y") != after.get("y")


def _dispatch_evidence(
    detail: Any,
    activation_options: ActivationOptions,
) -> list[Evidence]:
    changed = _scroll_changed(detail)
    records = [
        evidence(
            "dispatch",
            mode=detail.mode,
            activation=activation_options.activation,
            scroll=activation_options.scroll,
            actionability=activation_options.actionability,
            scroll_before=detail.scroll_before,
            scroll_after=detail.scroll_after,
            scroll_changed=changed,
            point=detail.point,
        )
    ]
    if activation_options.scroll != ClickScroll.AUTO and changed:
        # We did not scroll, but the page reacted by scrolling itself. Record it
        # so callers asserting on viewport stability can see what moved.
        records.append(
            evidence(
                "page-scrolled-itself",
                before=detail.scroll_before,
                after=detail.scroll_after,
            )
        )
    return records


async def click_element(
    page: Any,
    engine: EngineType,
    log: Logger,
    locator_or_element: Any,
    activation: str | None = None,
    scroll: str | None = None,
    actionability: str | None = None,
    no_auto_scroll: bool | None = None,
    verify: bool = True,
    verify_fn: Callable | None = None,
    adapter: Any | None = None,
    action_id: str | None = None,
) -> ClickResult:
    """Click an element (low-level).

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        log: Logger instance
        locator_or_element: Element or locator to click
        activation: 'pointer' (real input) or 'dom' (untrusted ``el.click()``)
        scroll: 'auto', 'preserve' (restore position) or 'none' (never scroll)
        actionability: 'normal' or 'force' (skip engine pre-checks)
        no_auto_scroll: Deprecated alias for ``scroll='none'``
        verify: Whether to verify the click effect (default: True)
        verify_fn: Custom verification function (optional)
        adapter: Engine adapter (optional)
        action_id: Correlation ID for this click

    Returns:
        ClickResult
    """
    if not locator_or_element:
        raise ValueError("locator_or_element is required")

    started_at = time.monotonic()
    action_id = action_id or next_action_id()

    def elapsed_ms() -> int:
        return int((time.monotonic() - started_at) * 1000)

    activation_options = resolve_activation_options(
        activation=activation,
        scroll=scroll,
        actionability=actionability,
        no_auto_scroll=no_auto_scroll,
        log=log,
    )

    try:
        if adapter is None:
            adapter = create_engine_adapter(page, engine)

        pre_click_state: dict = {}
        if verify and page:
            pre_click_state = await capture_pre_click_state(
                page=page,
                engine=engine,
                locator_or_element=locator_or_element,
                adapter=adapter,
            )

        try:
            detail = await dispatch_click(
                page=page,
                adapter=adapter,
                locator_or_element=locator_or_element,
                activation_options=activation_options,
                log=log,
            )
        except ScrollConstraintError as error:
            # The caller asked for no scrolling and we cannot deliver the click
            # without it. Say so instead of scrolling behind their back.
            return ClickResult(
                status=ClickStatus.FAILED,
                dispatched=False,
                effect=ClickEffect.NOT_OBSERVED,
                reason=str(error),
                evidence=[Evidence("scroll-constraint", error.detail)],
                elapsed_ms=elapsed_ms(),
                action_id=action_id,
            )

        dispatch_records = _dispatch_evidence(detail, activation_options)

        if not verify or not page:
            return ClickResult(
                status=ClickStatus.UNVERIFIED,
                dispatched=True,
                effect=ClickEffect.NOT_OBSERVED,
                reason="click dispatched; verification not requested",
                evidence=dispatch_records,
                elapsed_ms=elapsed_ms(),
                action_id=action_id,
            )

        verification = await verify_click(
            page=page,
            engine=engine,
            locator_or_element=locator_or_element,
            pre_click_state=pre_click_state,
            verify_fn=verify_fn,
            log=log,
        )

        effect = verification.resolved_effect()
        confirmed = effect == ClickEffect.CONFIRMED

        return ClickResult(
            status=ClickStatus.SUCCEEDED if confirmed else ClickStatus.UNVERIFIED,
            dispatched=True,
            effect=effect,
            reason=verification.reason,
            evidence=[*dispatch_records, *verification.evidence],
            elapsed_ms=elapsed_ms(),
            action_id=action_id,
            navigation_error=verification.navigation_error,
        )

    except Exception as error:
        if _is_interrupted(error):
            log.debug(
                lambda: "Navigation/stop interrupted the click, recovering gracefully"
            )
            return ClickResult(
                status=ClickStatus.INTERRUPTED,
                dispatched=False,
                effect=ClickEffect.NOT_OBSERVED,
                reason=(
                    "navigation or stop interrupted the click before it could "
                    "be observed"
                ),
                evidence=[evidence("interrupted", message=str(error))],
                elapsed_ms=elapsed_ms(),
                action_id=action_id,
            )
        raise


def _current_url(page: Any) -> str:
    if hasattr(page, "url"):
        return page.url() if callable(page.url) else page.url
    if hasattr(page, "current_url"):
        return page.current_url
    return ""


def _detect_navigation(
    page: Any,
    navigation_manager: Any | None,
    start_url: str,
    start_session_id: int | None,
    action_id: str,
    log: Logger,
) -> tuple[bool, bool, str, list[Evidence]]:
    """Detect whether navigation can be attributed to a specific click.

    A navigation that was already in flight before the click is not evidence
    about the click, so the navigation session recorded before dispatch is
    compared against the current one instead of merely asking "are we
    navigating".

    Args:
        page: Browser page object
        navigation_manager: NavigationManager instance (optional)
        start_url: URL before the click
        start_session_id: Navigation session ID before the click
        action_id: Correlation ID for the click
        log: Logger instance

    Returns:
        Tuple of (navigated, correlated, new_url, evidence)
    """
    new_url = _current_url(page)
    url_changed = new_url != start_url

    session_id = None
    if navigation_manager is not None and hasattr(navigation_manager, "get_session_id"):
        session_id = navigation_manager.get_session_id()

    session_advanced = (
        start_session_id is not None
        and session_id is not None
        and session_id > start_session_id
    )
    navigating = bool(
        navigation_manager is not None and navigation_manager.is_navigating()
    )

    correlated = url_changed or session_advanced
    navigated = correlated or navigating

    if navigated:
        relation = (
            "correlated with" if correlated else "in flight but NOT correlated with"
        )
        log.debug(
            lambda: f"Navigation {relation} click {action_id}: {start_url} -> {new_url}"
        )

    return (
        navigated,
        correlated,
        new_url,
        [
            evidence(
                "navigation",
                action_id=action_id,
                start_url=start_url,
                new_url=new_url,
                url_changed=url_changed,
                start_session_id=start_session_id,
                session_id=session_id,
                session_advanced=session_advanced,
                navigating=navigating,
                correlated=correlated,
            )
        ],
    )


async def click_button(
    page: Any,
    engine: EngineType,
    wait_fn: Callable[[int, str], Any],
    log: Logger,
    selector: str | Any,
    verbose: bool = False,
    navigation_manager: Any | None = None,
    network_tracker: Any | None = None,
    scroll_into_view: bool = True,
    wait_after_scroll: int | None = None,
    smooth_scroll: bool = True,
    wait_after_click: int = 1000,
    wait_for_navigation: bool = True,
    navigation_check_delay: int = 500,
    timeout: int | None = None,
    verify: bool = True,
    verify_fn: Callable | None = None,
    activation: str | None = None,
    scroll: str | None = None,
    actionability: str | None = None,
) -> ClickResult:
    """Click a button or element (high-level with scrolling and waits).

    Navigation-aware: waits for page ready after navigation-causing clicks, and
    only attributes the navigation to this click when the URL or the navigation
    session actually advanced.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        wait_fn: Wait function (ms, reason) -> Any
        log: Logger instance
        selector: CSS selector, ElementHandle, or Playwright Locator
        verbose: Enable verbose logging
        navigation_manager: NavigationManager instance (optional)
        network_tracker: NetworkTracker instance (optional)
        scroll_into_view: Scroll into view (default: True)
        wait_after_scroll: Wait time after scroll in ms
        smooth_scroll: Use smooth scroll animation (default: True)
        wait_after_click: Wait time after click in ms (default: 1000)
        wait_for_navigation: Wait for navigation to complete if click navigates
        navigation_check_delay: Time to check if navigation started (500ms)
        timeout: Timeout in ms
        verify: Whether to verify the click operation (default: True)
        verify_fn: Custom verification function (optional)
        activation: 'pointer' or 'dom'
        scroll: 'auto', 'preserve' or 'none'
        actionability: 'normal' or 'force'

    Returns:
        ClickResult
    """
    if timeout is None:
        timeout = TIMING.get("DEFAULT_TIMEOUT", 5000)
    if wait_after_scroll is None:
        wait_after_scroll = TIMING.get("DEFAULT_WAIT_AFTER_SCROLL", 300)

    if not selector:
        raise ValueError("selector is required")

    started_at = time.monotonic()
    action_id = next_action_id()

    def elapsed_ms() -> int:
        return int((time.monotonic() - started_at) * 1000)

    start_url = _current_url(page)
    start_session_id = None
    if navigation_manager is not None and hasattr(navigation_manager, "get_session_id"):
        start_session_id = navigation_manager.get_session_id()

    try:
        locator_or_element = await wait_for_locator_or_element(
            page=page,
            engine=engine,
            selector=selector,
            timeout=timeout,
        )

        if verbose:
            await log_element_info(
                page=page,
                engine=engine,
                log=log,
                locator_or_element=locator_or_element,
            )

        if scroll_into_view:
            behavior = "smooth" if smooth_scroll else "instant"
            scroll_result = await scroll_into_view_if_needed(
                page=page,
                engine=engine,
                wait_fn=wait_fn,
                log=log,
                locator_or_element=locator_or_element,
                behavior=behavior,
                wait_after_scroll=wait_after_scroll,
                verify=False,  # Overall click verification covers this.
            )

            if not scroll_result.skipped and not scroll_result.scrolled:
                return ClickResult(
                    status=ClickStatus.INTERRUPTED,
                    dispatched=False,
                    effect=ClickEffect.NOT_OBSERVED,
                    reason="navigation or stop interrupted the scroll before the click",
                    evidence=[evidence("interrupted", phase="scroll")],
                    elapsed_ms=elapsed_ms(),
                    action_id=action_id,
                )
        else:
            log.debug(lambda: "Skipping scroll (scroll_into_view: False)")

        log.debug(lambda: "About to click element")

        # Step 2 above already scrolled when it was allowed to, so a caller who
        # turned scrolling off means it for the click too.
        resolved_scroll = scroll
        if resolved_scroll is None:
            resolved_scroll = ClickScroll.AUTO if scroll_into_view else ClickScroll.NONE

        click_result = await click_element(
            page=page,
            engine=engine,
            log=log,
            locator_or_element=locator_or_element,
            activation=activation,
            scroll=resolved_scroll,
            actionability=actionability,
            verify=verify,
            verify_fn=verify_fn,
            action_id=action_id,
        )

        if not click_result.dispatched:
            return click_result

        log.debug(lambda: "Click completed")

        if wait_for_navigation:
            await wait_fn(navigation_check_delay, "checking for navigation after click")

            navigated, correlated, new_url, nav_evidence = _detect_navigation(
                page=page,
                navigation_manager=navigation_manager,
                start_url=start_url,
                start_session_id=start_session_id,
                action_id=action_id,
                log=log,
            )

            if navigated:
                log.debug(lambda: f"Click triggered navigation to: {new_url}")

                ready = True
                if navigation_manager:
                    ready = bool(
                        await navigation_manager.wait_for_page_ready(
                            120000, "after click navigation"
                        )
                    )
                elif network_tracker:
                    await network_tracker.wait_for_network_idle(120000, 30000)
                else:
                    await wait_fn(2000, "page settle after navigation")

                if not ready:
                    return ClickResult(
                        status=ClickStatus.TIMED_OUT,
                        dispatched=True,
                        effect=(
                            ClickEffect.CONFIRMED
                            if correlated
                            else ClickEffect.NOT_OBSERVED
                        ),
                        navigated=True,
                        reason="click navigated but the page never became ready",
                        evidence=[*click_result.evidence, *nav_evidence],
                        elapsed_ms=elapsed_ms(),
                        action_id=action_id,
                    )

                return ClickResult(
                    status=(
                        ClickStatus.SUCCEEDED if correlated else ClickStatus.UNVERIFIED
                    ),
                    dispatched=True,
                    effect=(
                        ClickEffect.CONFIRMED
                        if correlated
                        else ClickEffect.NOT_OBSERVED
                    ),
                    navigated=True,
                    reason=(
                        "click triggered navigation"
                        if correlated
                        else "navigation was in flight but could not be attributed "
                        "to this click"
                    ),
                    evidence=[*click_result.evidence, *nav_evidence],
                    elapsed_ms=elapsed_ms(),
                    action_id=action_id,
                )

            click_result.evidence = [*click_result.evidence, *nav_evidence]

        if wait_after_click > 0:
            await wait_fn(
                wait_after_click, "post-click settling time for modal scroll capture"
            )

        if network_tracker:
            await network_tracker.wait_for_network_idle(10000, 2000)

        click_result.elapsed_ms = elapsed_ms()
        if not click_result.reason:
            click_result.reason = "no navigation"
        return click_result

    except Exception as error:
        if _is_interrupted(error):
            log.debug(
                lambda: (
                    "Navigation/stop interrupted click_button, recovering gracefully"
                )
            )
            return ClickResult(
                status=ClickStatus.INTERRUPTED,
                dispatched=False,
                effect=ClickEffect.NOT_OBSERVED,
                navigated=True,
                reason=(
                    "navigation or stop interrupted the click before it could "
                    "be observed"
                ),
                evidence=[evidence("interrupted", message=str(error))],
                elapsed_ms=elapsed_ms(),
                action_id=action_id,
            )
        raise
