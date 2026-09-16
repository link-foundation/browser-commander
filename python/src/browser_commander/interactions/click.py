"""Click interactions for browser-commander.

This module provides click functions for both Playwright and Selenium engines.

Click results report what was *observed*. An element that is still present and
unchanged after a click is not evidence that the click did anything - that is
exactly the case of a button whose handler is missing or threw - so it is
reported as ``not-observed`` rather than as success.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Awaitable
from typing import Any, Callable

from browser_commander.core.constants import TIMING
from browser_commander.core.engine_adapter import create_engine_adapter
from browser_commander.core.engine_detection import EngineType
from browser_commander.core.logger import Logger
from browser_commander.core.readiness import Deadline, run_within_deadline
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
from browser_commander.interactions.click_verification import (
    capture_pre_click_state,
    default_click_verification,
    is_interrupted,
    verify_click,
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
    timeout: float | None = None,
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
        timeout: Budget for the whole click, verification included

    Returns:
        ClickResult
    """
    if not locator_or_element:
        raise ValueError("locator_or_element is required")

    # One monotonic budget covers dispatch, probing and verification, so no
    # step can quietly extend the click past what the caller asked for.
    deadline = Deadline(TIMING["VERIFICATION_TIMEOUT"] if timeout is None else timeout)
    action_id = action_id or next_action_id()

    def elapsed_ms() -> int:
        return deadline.elapsed_ms()

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

        url_before_dispatch = _current_url(page) if page else ""

        pre_click_state: dict = {}
        if verify and page:
            pre_click_state = await capture_pre_click_state(
                page=page,
                engine=engine,
                locator_or_element=locator_or_element,
                adapter=adapter,
                deadline=deadline,
            )

        try:
            # Dispatch is bounded too: locating a click point and reading the
            # scroll position are engine round-trips, and an unbounded one
            # spends the budget the caller reserved for the whole click.
            dispatching = await run_within_deadline(
                deadline,
                lambda: dispatch_click(
                    page=page,
                    adapter=adapter,
                    locator_or_element=locator_or_element,
                    activation_options=activation_options,
                    log=log,
                ),
            )

            if dispatching.timed_out:
                return ClickResult(
                    status=ClickStatus.TIMED_OUT,
                    dispatched=False,
                    effect=ClickEffect.NOT_OBSERVED,
                    reason=(
                        "click budget expired before the click could be dispatched"
                    ),
                    evidence=[
                        Evidence(
                            "dispatch-timeout",
                            {
                                "timeoutMs": deadline.timeout_ms,
                                "elapsedMs": deadline.elapsed_ms(),
                            },
                        )
                    ],
                    elapsed_ms=elapsed_ms(),
                    action_id=action_id,
                )

            detail = dispatching.value
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

        verification, navigated_to = await _verify_until_navigation(
            url_before_dispatch,
            page,
            verify_click(
                page=page,
                engine=engine,
                locator_or_element=locator_or_element,
                pre_click_state=pre_click_state,
                verify_fn=verify_fn,
                log=log,
                adapter=adapter,
                deadline=deadline,
            ),
        )

        if verification is None:
            # The document the element belonged to is gone, so there is nothing
            # left to observe. The navigation is recorded as what it is - a
            # correlated event - and *not* as proof that this click caused it.
            return ClickResult(
                status=ClickStatus.UNVERIFIED,
                dispatched=True,
                effect=ClickEffect.NOT_OBSERVED,
                reason=(
                    "the page navigated after the click, so the click effect "
                    "could not be observed on the original document"
                ),
                evidence=[
                    *dispatch_records,
                    evidence(
                        "navigation",
                        action_id=action_id,
                        from_url=url_before_dispatch,
                        to=navigated_to,
                        correlated=True,
                        proves_click_effect=False,
                    ),
                ],
                elapsed_ms=elapsed_ms(),
                action_id=action_id,
                navigation_error=True,
            )

        effect = verification.resolved_effect()
        confirmed = effect == ClickEffect.CONFIRMED

        return ClickResult(
            # The click was delivered either way; only the observation ran out
            # of time, and `timed_out` says exactly that rather than blaming
            # the click.
            status=_verification_status(confirmed, verification.timed_out),
            dispatched=True,
            effect=effect,
            reason=verification.reason,
            evidence=[*dispatch_records, *verification.evidence],
            elapsed_ms=elapsed_ms(),
            action_id=action_id,
            navigation_error=verification.navigation_error,
        )

    except Exception as error:
        if is_interrupted(error):
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


def _verification_status(confirmed: bool, timed_out: bool) -> str:
    """Report how a dispatched click ended, given what verification observed.

    Args:
        confirmed: Whether an effect was actually observed
        timed_out: Whether verification ran out of budget

    Returns:
        One of :class:`ClickStatus`
    """
    if confirmed:
        return ClickStatus.SUCCEEDED
    return ClickStatus.TIMED_OUT if timed_out else ClickStatus.UNVERIFIED


def _current_url(page: Any) -> str:
    if hasattr(page, "url"):
        return page.url() if callable(page.url) else page.url
    if hasattr(page, "current_url"):
        return page.current_url
    return ""


#: How often the navigation watch samples the page URL, in seconds.
_NAVIGATION_POLL_INTERVAL = 0.05


async def _watch_for_navigation(page: Any, url_before: str) -> str:
    """Wait until the page leaves the document a click was dispatched into.

    A navigation replaces the document, and engines answer an element probe on
    the *new* document instead of failing - which is how a navigating click used
    to spend its whole budget waiting for an element that no longer exists.

    Args:
        page: Browser page object
        url_before: URL read immediately before dispatch

    Returns:
        The new URL, once it differs from the one before the click
    """
    while True:
        await asyncio.sleep(_NAVIGATION_POLL_INTERVAL)
        now = _current_url(page)
        if now and now != url_before:
            return now


async def _verify_until_navigation(
    url_before: str,
    page: Any,
    verification: Awaitable[ClickVerificationResult],
) -> tuple[ClickVerificationResult | None, str | None]:
    """Verify a click, giving up as soon as the page navigates away.

    Args:
        url_before: URL read immediately before dispatch
        page: Browser page object
        verification: The verification in progress

    Returns:
        The verdict and the URL navigated to; exactly one of the two is set
    """
    verifying = asyncio.ensure_future(verification)
    if not url_before:
        return await verifying, None

    watching = asyncio.ensure_future(_watch_for_navigation(page, url_before))
    try:
        done, _pending = await asyncio.wait(
            {verifying, watching},
            return_when=asyncio.FIRST_COMPLETED,
        )
        if verifying in done:
            return verifying.result(), None
        return None, watching.result()
    finally:
        for task in (verifying, watching):
            if not task.done():
                task.cancel()
                # The loser still settles; absorbing it keeps a cancelled probe
                # from surfacing later as a task nobody awaited.
                with contextlib.suppress(BaseException):
                    await task


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

    # The same budget covers locating, scrolling, clicking and verifying, so a
    # button click cannot quietly cost several times the timeout asked for.
    deadline = Deadline(timeout)
    action_id = next_action_id()

    def elapsed_ms() -> int:
        return deadline.elapsed_ms()

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
            timeout=deadline.remaining_ms(),
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
        if is_interrupted(error):
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
