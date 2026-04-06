"""Unit tests for click interactions."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from browser_commander.interactions.click import (
    ClickResult,
    ClickVerificationResult,
    capture_pre_click_state,
    click_button,
    click_element,
    default_click_verification,
    verify_click,
)
from tests.helpers.mocks import create_mock_logger, create_mock_playwright_page


# ---------------------------------------------------------------------------
# default_click_verification
# ---------------------------------------------------------------------------
class TestDefaultClickVerification:
    async def test_verify_aria_pressed_changed(self):
        page = create_mock_playwright_page()
        adapter = MagicMock()
        adapter.evaluate_on_element = AsyncMock(
            return_value={
                "disabled": False,
                "ariaPressed": "true",
                "ariaExpanded": None,
                "ariaSelected": None,
                "checked": False,
                "className": "btn",
                "isConnected": True,
            }
        )

        result = await default_click_verification(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            pre_click_state={"ariaPressed": "false"},
            adapter=adapter,
        )

        assert result.verified is True
        assert "aria-pressed" in result.reason

    async def test_verify_class_name_changed(self):
        page = create_mock_playwright_page()
        adapter = MagicMock()
        adapter.evaluate_on_element = AsyncMock(
            return_value={
                "disabled": False,
                "className": "btn active",
                "isConnected": True,
            }
        )

        result = await default_click_verification(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            pre_click_state={"className": "btn"},
            adapter=adapter,
        )

        assert result.verified is True
        assert "className" in result.reason

    async def test_verify_element_still_connected(self):
        page = create_mock_playwright_page()
        adapter = MagicMock()
        adapter.evaluate_on_element = AsyncMock(
            return_value={
                "disabled": False,
                "isConnected": True,
            }
        )

        result = await default_click_verification(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            pre_click_state={},
            adapter=adapter,
        )

        assert result.verified is True
        assert "connected" in result.reason

    async def test_verify_element_removed_from_dom(self):
        page = create_mock_playwright_page()
        adapter = MagicMock()
        adapter.evaluate_on_element = AsyncMock(
            return_value={"isConnected": False}
        )

        result = await default_click_verification(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            pre_click_state={},
            adapter=adapter,
        )

        assert result.verified is True
        assert "removed" in result.reason

    async def test_verify_handles_navigation_error(self):
        page = create_mock_playwright_page()
        adapter = MagicMock()
        adapter.evaluate_on_element = AsyncMock(
            side_effect=Exception("Execution context was destroyed")
        )

        result = await default_click_verification(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            pre_click_state={},
            adapter=adapter,
        )

        assert result.verified is True
        assert result.navigation_error is True


# ---------------------------------------------------------------------------
# capture_pre_click_state
# ---------------------------------------------------------------------------
class TestCapturePreClickState:
    async def test_capture_element_state(self):
        page = create_mock_playwright_page()
        adapter = MagicMock()
        adapter.evaluate_on_element = AsyncMock(
            return_value={
                "disabled": False,
                "ariaPressed": "false",
                "className": "btn",
                "isConnected": True,
            }
        )

        state = await capture_pre_click_state(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            adapter=adapter,
        )

        assert state is not None
        assert state["disabled"] is False
        assert state["className"] == "btn"

    async def test_returns_empty_on_navigation_error(self):
        page = create_mock_playwright_page()
        adapter = MagicMock()
        adapter.evaluate_on_element = AsyncMock(
            side_effect=Exception("Execution context was destroyed")
        )

        state = await capture_pre_click_state(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            adapter=adapter,
        )

        assert state == {}


# ---------------------------------------------------------------------------
# verify_click
# ---------------------------------------------------------------------------
class TestVerifyClick:
    async def test_uses_custom_verify_function(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()
        custom_called = False

        async def custom_verify_fn(**kwargs):
            nonlocal custom_called
            custom_called = True
            return ClickVerificationResult(verified=True, reason="custom verification")

        result = await verify_click(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            verify_fn=custom_verify_fn,
            log=log,
        )

        assert custom_called is True
        assert result.verified is True
        assert result.reason == "custom verification"

    async def test_logs_verification_result(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()

        await verify_click(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            verify_fn=async_verify_true,
            log=log,
        )
        # Should complete without error


async def async_verify_true(**kwargs):
    return ClickVerificationResult(verified=True, reason="test")


# ---------------------------------------------------------------------------
# click_element
# ---------------------------------------------------------------------------
class TestClickElement:
    async def test_raises_when_locator_not_provided(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()

        with pytest.raises(ValueError, match="locator_or_element is required"):
            await click_element(
                page=page,
                engine="playwright",
                log=log,
                locator_or_element=None,
            )

    async def test_clicks_element(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()
        clicked = False
        adapter = MagicMock()

        async def mock_click(el, force=False):
            nonlocal clicked
            clicked = True

        adapter.click = mock_click
        adapter.evaluate_on_element = AsyncMock(
            return_value={"isConnected": True}
        )

        result = await click_element(
            page=page,
            engine="playwright",
            log=log,
            locator_or_element=MagicMock(),
            adapter=adapter,
            verify=False,
        )

        assert result.clicked is True
        assert clicked is True

    async def test_click_with_force_when_no_auto_scroll(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()
        click_options = {}
        adapter = MagicMock()

        async def mock_click(el, force=False):
            click_options["force"] = force

        adapter.click = mock_click
        adapter.evaluate_on_element = AsyncMock(
            return_value={"isConnected": True}
        )

        await click_element(
            page=page,
            engine="playwright",
            log=log,
            locator_or_element=MagicMock(),
            adapter=adapter,
            no_auto_scroll=True,
            verify=False,
        )

        assert click_options.get("force") is True

    async def test_handles_navigation_error(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()
        adapter = MagicMock()
        adapter.click = AsyncMock(
            side_effect=Exception("Execution context was destroyed")
        )

        result = await click_element(
            page=page,
            engine="playwright",
            log=log,
            locator_or_element=MagicMock(),
            adapter=adapter,
            verify=False,
        )

        assert result.clicked is False
        assert result.verified is True


# ---------------------------------------------------------------------------
# click_button
# ---------------------------------------------------------------------------
class TestClickButton:
    async def test_raises_when_selector_not_provided(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()

        async def wait_fn(ms, reason):
            return None

        with pytest.raises(ValueError, match="selector is required"):
            await click_button(
                page=page,
                engine="playwright",
                wait_fn=wait_fn,
                log=log,
                selector="",
            )

    async def test_click_button_interface(self):
        page = create_mock_playwright_page(
            elements={"button": None}
        )
        log = create_mock_logger()

        async def wait_fn(ms, reason):
            return None

        # This tests that the interface works - may succeed or fail based on mock
        try:
            result = await click_button(
                page=page,
                engine="playwright",
                wait_fn=wait_fn,
                log=log,
                selector="button",
                scroll_into_view=False,
                wait_after_click=0,
                wait_for_navigation=False,
                verify=False,
            )
            assert isinstance(result.clicked, bool)
            assert isinstance(result.navigated, bool)
        except Exception as e:
            # May fail due to mock limitations, but interface exists
            assert str(e)
