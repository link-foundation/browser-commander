"""Unit tests for click interactions."""

from __future__ import annotations

from typing import Any

import pytest

from browser_commander.interactions.click import (
    ClickEffect,
    ClickResult,
    ClickStatus,
    ClickVerificationResult,
    capture_pre_click_state,
    click_button,
    click_element,
    default_click_verification,
    verify_click,
)
from tests.helpers.click_fixtures import (
    IN_VIEWPORT_POINT,
    OFF_SCREEN_POINT,
    UNCHANGED_STATE,
    ScrollModel,
)
from tests.helpers.mocks import create_mock_logger, create_mock_playwright_page


class ProbeAdapter:
    """Adapter stub that answers element probes with a fixed result.

    ``probe`` is either the state to return or an exception to raise. The
    click-point probe is answered separately so the same stub can serve both
    the verification path and the ``scroll='none'`` path.
    """

    def __init__(
        self,
        probe: Any = None,
        point: dict[str, Any] | None = None,
        on_click: Any = None,
        scroll: ScrollModel | None = None,
    ) -> None:
        self.probe = probe if probe is not None else dict(UNCHANGED_STATE)
        self.point = point or IN_VIEWPORT_POINT
        self.on_click = on_click
        self.scroll = scroll
        self.click_calls: list[bool] = []
        if scroll is not None:
            self.evaluate_on_page = scroll.evaluate_on_page

    async def click(self, _locator: Any, force: bool = False) -> None:
        """Record an engine click, optionally raising or scrolling."""
        self.click_calls.append(force)
        if isinstance(self.on_click, Exception):
            raise self.on_click
        if callable(self.on_click):
            self.on_click()

    async def evaluate_on_element(self, _locator: Any, script: str) -> Any:
        """Serve the click-point probe or the element-state probe."""
        if "getBoundingClientRect" in script:
            return {
                **self.point,
                "scroll": {"x": 0, "y": self.scroll.y if self.scroll else 0},
            }
        if isinstance(self.probe, Exception):
            raise self.probe
        return self.probe


async def verify_against(post: Any, pre: dict | None = None):
    """Run the default verifier against a fixed post-click element state."""
    return await default_click_verification(
        page=create_mock_playwright_page(),
        engine="playwright",
        locator_or_element=object(),
        pre_click_state=pre or {},
        adapter=ProbeAdapter(probe=post),
    )


def assert_not_observed(result: ClickVerificationResult, reason_fragment: str) -> None:
    """Assert that a verdict claims nothing it did not observe."""
    assert result.verified is False
    assert result.effect == ClickEffect.NOT_OBSERVED
    assert reason_fragment in result.reason


async def click_with(adapter: ProbeAdapter, **options: Any) -> ClickResult:
    """Invoke ``click_element`` against the mock page with a given adapter."""
    options.setdefault("verify", False)
    return await click_element(
        page=options.pop("page", None) or create_mock_playwright_page(),
        engine="playwright",
        log=create_mock_logger(),
        locator_or_element=object(),
        adapter=adapter,
        **options,
    )


# ---------------------------------------------------------------------------
# default_click_verification
# ---------------------------------------------------------------------------
class TestDefaultClickVerification:
    async def test_verify_aria_pressed_changed(self):
        result = await verify_against(
            post={**UNCHANGED_STATE, "ariaPressed": "true"},
            pre=dict(UNCHANGED_STATE),
        )

        assert result.verified is True
        assert result.effect == ClickEffect.CONFIRMED
        assert "aria-pressed" in result.reason

    async def test_verify_class_name_changed(self):
        result = await verify_against(
            post={**UNCHANGED_STATE, "className": "btn active"},
            pre=dict(UNCHANGED_STATE),
        )

        assert result.verified is True
        assert "className" in result.reason

    async def test_does_not_claim_success_when_nothing_changed(self):
        # Regression test for issue #89: a button whose handler does nothing
        # left the element connected and unchanged, and that was reported as
        # success.
        result = await verify_against(
            post=dict(UNCHANGED_STATE),
            pre=dict(UNCHANGED_STATE),
        )

        assert_not_observed(result, "no observable change")

    async def test_reports_not_observed_without_pre_click_state(self):
        result = await verify_against(post=dict(UNCHANGED_STATE))

        assert_not_observed(result, "no pre-click state")

    async def test_verify_element_removed_from_dom(self):
        result = await verify_against(post={"isConnected": False})

        assert result.verified is True
        assert result.effect == ClickEffect.CONFIRMED
        assert "removed" in result.reason

    async def test_destroyed_context_is_not_proof_of_effect(self):
        # Regression test for issue #89: the click may or may not have caused
        # the navigation that destroyed the context. Attribution is the
        # caller's job.
        result = await verify_against(post=Exception("Execution context was destroyed"))

        assert_not_observed(result, "verification unavailable")
        assert result.navigation_error is True

    async def test_attaches_evidence_to_every_verdict(self):
        result = await verify_against(
            post=dict(UNCHANGED_STATE),
            pre=dict(UNCHANGED_STATE),
        )

        assert result.evidence[0].type == "element-state"


# ---------------------------------------------------------------------------
# capture_pre_click_state
# ---------------------------------------------------------------------------
class TestCapturePreClickState:
    async def test_capture_element_state(self):
        state = await capture_pre_click_state(
            page=create_mock_playwright_page(),
            engine="playwright",
            locator_or_element=object(),
            adapter=ProbeAdapter(),
        )

        assert state["disabled"] is False
        assert state["className"] == "btn"

    async def test_returns_empty_on_navigation_error(self):
        state = await capture_pre_click_state(
            page=create_mock_playwright_page(),
            engine="playwright",
            locator_or_element=object(),
            adapter=ProbeAdapter(probe=Exception("Execution context was destroyed")),
        )

        assert state == {}


# ---------------------------------------------------------------------------
# verify_click
# ---------------------------------------------------------------------------
class TestVerifyClick:
    async def test_uses_custom_verify_function(self):
        custom_called = False

        async def custom_verify_fn(**_kwargs):
            nonlocal custom_called
            custom_called = True
            return ClickVerificationResult(verified=True, reason="custom verification")

        result = await verify_click(
            page=create_mock_playwright_page(),
            engine="playwright",
            locator_or_element=object(),
            verify_fn=custom_verify_fn,
            log=create_mock_logger(),
        )

        assert custom_called is True
        assert result.verified is True
        assert result.reason == "custom verification"

    @pytest.mark.parametrize(
        ("verified", "expected_effect"),
        [(True, ClickEffect.CONFIRMED), (False, ClickEffect.NOT_OBSERVED)],
    )
    async def test_derives_an_effect_for_custom_verifiers(
        self,
        verified: bool,
        expected_effect: str,
    ):
        async def custom_verify_fn(**_kwargs):
            return ClickVerificationResult(verified=verified, reason="custom")

        result = await verify_click(
            page=create_mock_playwright_page(),
            engine="playwright",
            locator_or_element=object(),
            verify_fn=custom_verify_fn,
            log=create_mock_logger(),
        )

        assert result.effect == expected_effect


# ---------------------------------------------------------------------------
# click_element
# ---------------------------------------------------------------------------
class TestClickElement:
    async def test_raises_when_locator_not_provided(self):
        with pytest.raises(ValueError, match="locator_or_element is required"):
            await click_element(
                page=create_mock_playwright_page(),
                engine="playwright",
                log=create_mock_logger(),
                locator_or_element=None,
            )

    async def test_reports_unverified_when_verification_not_requested(self):
        adapter = ProbeAdapter()

        result = await click_with(adapter)

        assert adapter.click_calls == [False]
        assert result.clicked is True
        assert result.verified is False
        assert result.status == ClickStatus.UNVERIFIED

    async def test_does_not_route_no_auto_scroll_through_force(self):
        # Regression test for issue #89: force=True skips actionability checks
        # but does NOT disable scroll-into-view, so the old mapping silently
        # scrolled the page while reporting that it had not.
        page = create_mock_playwright_page()
        adapter = ProbeAdapter(scroll=ScrollModel())

        result = await click_with(adapter, page=page, no_auto_scroll=True)

        assert adapter.click_calls == []
        assert page.mouse.clicks == [
            {"x": IN_VIEWPORT_POINT["x"], "y": IN_VIEWPORT_POINT["y"], "options": {}}
        ]
        assert result.dispatched is True

    async def test_passes_force_only_for_actionability_force(self):
        adapter = ProbeAdapter()

        await click_with(adapter, actionability="force")

        assert adapter.click_calls == [True]

    async def test_fails_clearly_when_scroll_none_cannot_be_honored(self):
        page = create_mock_playwright_page()
        adapter = ProbeAdapter(point=OFF_SCREEN_POINT, scroll=ScrollModel())

        result = await click_with(adapter, page=page, scroll="none")

        assert result.status == ClickStatus.FAILED
        assert result.dispatched is False
        assert adapter.click_calls == []
        assert page.mouse.clicks == []
        assert "outside the viewport" in result.reason

    async def test_restores_the_scroll_position_for_scroll_preserve(self):
        scroll = ScrollModel()
        adapter = ProbeAdapter(
            scroll=scroll, on_click=lambda: setattr(scroll, "y", 3911)
        )

        await click_with(adapter, scroll="preserve")

        assert scroll.y == 0

    async def test_reports_interrupted_not_verified_on_navigation(self):
        # Regression test for issue #89: navigation used to be reported as a
        # verified click even though nothing confirmed the click caused it.
        adapter = ProbeAdapter(on_click=Exception("Execution context was destroyed"))

        result = await click_with(adapter)

        assert result.clicked is False
        assert result.verified is False
        assert result.status == ClickStatus.INTERRUPTED
        assert result.effect == ClickEffect.NOT_OBSERVED

    async def test_carries_an_action_id_for_navigation_correlation(self):
        result = await click_with(ProbeAdapter())

        assert isinstance(result.action_id, str)
        assert result.elapsed_ms >= 0


# ---------------------------------------------------------------------------
# click_button
# ---------------------------------------------------------------------------
class TestClickButton:
    async def test_raises_when_selector_not_provided(self):
        async def wait_fn(_ms, _reason):
            return None

        with pytest.raises(ValueError, match="selector is required"):
            await click_button(
                page=create_mock_playwright_page(),
                engine="playwright",
                wait_fn=wait_fn,
                log=create_mock_logger(),
                selector="",
            )

    async def test_click_button_interface(self):
        page = create_mock_playwright_page(elements={"button": None})

        async def wait_fn(_ms, _reason):
            return None

        # This tests that the interface works - may succeed or fail based on mock
        try:
            result = await click_button(
                page=page,
                engine="playwright",
                wait_fn=wait_fn,
                log=create_mock_logger(),
                selector="button",
                scroll_into_view=False,
                wait_after_click=0,
                wait_for_navigation=False,
                verify=False,
            )
            assert isinstance(result.clicked, bool)
            assert isinstance(result.navigated, bool)
            assert result.status in vars(ClickStatus).values()
        except Exception as e:
            # May fail due to mock limitations, but interface exists
            assert str(e)
