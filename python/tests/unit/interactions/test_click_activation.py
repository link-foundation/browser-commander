"""Unit tests for orthogonal click activation."""

from __future__ import annotations

from typing import Any

import pytest

from browser_commander.interactions.click_activation import (
    ClickActionability,
    ClickActivation,
    ClickScroll,
    ScrollConstraintError,
    dispatch_click,
    measure_click_point,
    read_scroll_position,
    resolve_activation_options,
    restore_scroll_position,
)
from tests.helpers.click_fixtures import (
    IN_VIEWPORT_POINT,
    OFF_SCREEN_POINT,
    ScrollModel,
)
from tests.helpers.mocks import create_mock_logger


class RecordingAdapter:
    """Adapter stub recording what the engine was asked to do.

    It also models a scroll position the engine may move, so the tests can
    assert what happened to the viewport.
    """

    def __init__(
        self,
        point: dict[str, Any] | None = None,
        scroll_on_click: float = 0,
        has_evaluate_on_page: bool = True,
    ) -> None:
        self.point = point or IN_VIEWPORT_POINT
        self.scroll_on_click = scroll_on_click
        self.scroll = ScrollModel()
        self.click_calls: list[bool] = []
        self.dom_clicks = 0
        if has_evaluate_on_page:
            self.evaluate_on_page = self.scroll.evaluate_on_page

    async def click(self, _locator: Any, force: bool = False) -> None:
        """Record an engine click and let the engine scroll."""
        self.click_calls.append(force)
        self.scroll.y = self.scroll_on_click

    async def evaluate_on_element(self, _locator: Any, script: str) -> Any:
        """Serve the click-point probe or record a DOM activation."""
        if "el.click()" in script:
            self.dom_clicks += 1
            return None
        return {**self.point, "scroll": {"x": 0, "y": self.scroll.y}}


class RecordingMouse:
    """Page mouse stub recording viewport-coordinate clicks."""

    def __init__(self) -> None:
        self.clicks: list[dict[str, float]] = []

    async def click(self, x: float, y: float, **_options: Any) -> None:
        """Record a pointer click."""
        self.clicks.append({"x": x, "y": y})


class RecordingPage:
    """Page stub exposing only the pointer surface the click path needs."""

    def __init__(self) -> None:
        self.mouse = RecordingMouse()


async def dispatch(adapter: RecordingAdapter, page: RecordingPage, **activation: Any):
    """Dispatch one click through the resolved activation options."""
    return await dispatch_click(
        page=page,
        adapter=adapter,
        locator_or_element=object(),
        activation_options=resolve_activation_options(**activation),
    )


class TestResolveActivationOptions:
    def test_defaults_to_a_pointer_click_that_may_scroll(self):
        resolved = resolve_activation_options()

        assert resolved.activation == ClickActivation.POINTER
        assert resolved.scroll == ClickScroll.AUTO
        assert resolved.actionability == ClickActionability.NORMAL
        assert resolved.deprecations == []

    def test_maps_deprecated_no_auto_scroll_onto_scroll_semantics(self):
        # Regression test for issue #89: no_auto_scroll used to mean
        # force=True, which is an actionability flag, not a scroll flag.
        on = resolve_activation_options(no_auto_scroll=True)
        assert on.scroll == ClickScroll.NONE
        assert on.actionability == ClickActionability.NORMAL
        assert len(on.deprecations) == 1
        assert "no_auto_scroll is deprecated" in on.deprecations[0]

        off = resolve_activation_options(no_auto_scroll=False)
        assert off.scroll == ClickScroll.AUTO

    def test_explicit_scroll_wins_over_no_auto_scroll(self):
        resolved = resolve_activation_options(
            no_auto_scroll=True,
            scroll=ClickScroll.PRESERVE,
        )

        assert resolved.scroll == ClickScroll.PRESERVE

    def test_logs_the_deprecation_notice(self):
        log = create_mock_logger(collect_logs=True)

        resolve_activation_options(no_auto_scroll=True, log=log)

        messages = [entry["message"] for entry in log.get_logs()]
        assert any("deprecated" in message for message in messages)

    @pytest.mark.parametrize(
        ("axis", "value"),
        [
            ("activation", "telepathy"),
            ("scroll", "maybe"),
            ("actionability", "hard"),
        ],
    )
    def test_rejects_unknown_values_on_every_axis(self, axis: str, value: str):
        with pytest.raises(ValueError, match=f"{axis} must be one of"):
            resolve_activation_options(**{axis: value})


class TestMeasureClickPoint:
    async def test_reports_the_element_centre_and_hit_test(self):
        point = await measure_click_point(RecordingAdapter(), object())

        assert point["x"] == 50
        assert point["y"] == 60
        assert point["inViewport"] is True
        assert point["hitsTarget"] is True


class TestScrollPositionHelpers:
    async def test_tolerates_an_adapter_without_evaluate_on_page(self):
        adapter = RecordingAdapter(has_evaluate_on_page=False)

        assert await read_scroll_position(adapter) is None
        await restore_scroll_position(adapter, {"x": 0, "y": 10})

    async def test_tolerates_an_adapter_that_throws(self):
        class ThrowingAdapter:
            async def evaluate_on_page(self, *_args: Any) -> Any:
                raise RuntimeError("context destroyed")

        assert await read_scroll_position(ThrowingAdapter()) is None

    async def test_does_nothing_when_there_is_no_position_to_restore(self):
        adapter = RecordingAdapter()

        await restore_scroll_position(adapter, None)

        assert adapter.scroll.y == 0


class TestDispatchClick:
    async def test_sends_force_only_for_actionability_force(self):
        normal = RecordingAdapter()
        await dispatch(normal, RecordingPage())
        assert normal.click_calls == [False]

        forced = RecordingAdapter()
        await dispatch(
            forced,
            RecordingPage(),
            actionability=ClickActionability.FORCE,
        )
        assert forced.click_calls == [True]

    async def test_restores_the_scroll_position_for_scroll_preserve(self):
        # The engine is free to scroll; the caller asked for the viewport to
        # end up where it started.
        adapter = RecordingAdapter(scroll_on_click=3911)

        detail = await dispatch(
            adapter,
            RecordingPage(),
            scroll=ClickScroll.PRESERVE,
        )

        assert adapter.scroll.y == 0
        assert detail.scroll_after == {"x": 0, "y": 0}

    async def test_uses_a_real_pointer_at_the_element_point_for_scroll_none(self):
        # Regression test for issue #89: force=True still scrolled (scrollY
        # 0 -> 3911 in the live repro). A mouse click at the measured point
        # cannot scroll at all.
        adapter = RecordingAdapter(scroll_on_click=3911)
        page = RecordingPage()

        detail = await dispatch(adapter, page, scroll=ClickScroll.NONE)

        assert page.mouse.clicks == [{"x": 50, "y": 60}]
        assert adapter.click_calls == []
        assert adapter.scroll.y == 0
        assert detail.scroll_before["y"] == detail.scroll_after["y"]

    async def test_refuses_scroll_none_when_the_element_is_off_screen(self):
        adapter = RecordingAdapter(point=OFF_SCREEN_POINT)
        page = RecordingPage()

        with pytest.raises(ScrollConstraintError) as excinfo:
            await dispatch(adapter, page, scroll=ClickScroll.NONE)

        assert "outside the viewport" in str(excinfo.value)
        assert 'scroll="preserve"' in str(excinfo.value)
        assert excinfo.value.detail["inViewport"] is False
        assert page.mouse.clicks == []

    async def test_refuses_scroll_none_when_another_element_covers_the_target(self):
        adapter = RecordingAdapter(point={**IN_VIEWPORT_POINT, "hitsTarget": False})
        page = RecordingPage()

        with pytest.raises(ScrollConstraintError, match="covers the target"):
            await dispatch(adapter, page, scroll=ClickScroll.NONE)

        assert page.mouse.clicks == []

    async def test_refuses_scroll_none_when_the_engine_has_no_pointer_api(self):
        # Selenium and the Node bridge cannot dispatch viewport-coordinate
        # pointer input, so the constraint is refused rather than ignored.
        class PointerlessPage:
            pass

        adapter = RecordingAdapter()

        with pytest.raises(ScrollConstraintError, match="pointer input"):
            await dispatch(adapter, PointerlessPage(), scroll=ClickScroll.NONE)

        assert adapter.click_calls == []

    async def test_dispatches_an_untrusted_dom_click_for_activation_dom(self):
        adapter = RecordingAdapter()
        page = RecordingPage()

        detail = await dispatch(adapter, page, activation=ClickActivation.DOM)

        assert adapter.dom_clicks == 1
        assert adapter.click_calls == []
        assert page.mouse.clicks == []
        assert detail.mode == ClickActivation.DOM
        assert detail.point is None
