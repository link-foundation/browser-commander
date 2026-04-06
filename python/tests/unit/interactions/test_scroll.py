"""Unit tests for scroll interactions."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from browser_commander.interactions.scroll import (
    default_scroll_verification,
    needs_scrolling,
    scroll_into_view,
    scroll_into_view_if_needed,
    verify_scroll,
)
from tests.helpers.mocks import create_mock_logger, create_mock_playwright_page


# ---------------------------------------------------------------------------
# default_scroll_verification
# ---------------------------------------------------------------------------
class TestDefaultScrollVerification:
    async def test_verifies_element_in_viewport_playwright(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.evaluate = AsyncMock(return_value=True)

        result = await default_scroll_verification(
            page=page,
            engine="playwright",
            locator_or_element=mock_locator,
        )

        assert result.verified is True
        assert result.in_viewport is True

    async def test_returns_false_when_not_in_viewport(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.evaluate = AsyncMock(return_value=False)

        result = await default_scroll_verification(
            page=page,
            engine="playwright",
            locator_or_element=mock_locator,
        )

        assert result.verified is False
        assert result.in_viewport is False

    async def test_handles_navigation_error(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.evaluate = AsyncMock(
            side_effect=Exception("Execution context was destroyed")
        )

        result = await default_scroll_verification(
            page=page,
            engine="playwright",
            locator_or_element=mock_locator,
        )

        assert result.verified is False
        assert result.navigation_error is True


# ---------------------------------------------------------------------------
# verify_scroll
# ---------------------------------------------------------------------------
class TestVerifyScroll:
    async def test_verifies_scroll_with_retry(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()
        mock_locator = MagicMock()
        mock_locator.evaluate = AsyncMock(return_value=True)

        result = await verify_scroll(
            page=page,
            engine="playwright",
            locator_or_element=mock_locator,
            log=log,
            timeout=100,
        )

        assert result.verified is True
        assert result.attempts >= 1

    async def test_fails_after_timeout_if_never_in_viewport(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()
        mock_locator = MagicMock()
        mock_locator.evaluate = AsyncMock(return_value=False)

        result = await verify_scroll(
            page=page,
            engine="playwright",
            locator_or_element=mock_locator,
            log=log,
            timeout=50,
            retry_interval=10,
        )

        assert result.verified is False
        assert result.attempts >= 1


# ---------------------------------------------------------------------------
# scroll_into_view
# ---------------------------------------------------------------------------
class TestScrollIntoView:
    async def test_raises_when_locator_not_provided(self):
        page = create_mock_playwright_page()

        with pytest.raises(ValueError, match="locator_or_element is required"):
            await scroll_into_view(
                page=page,
                engine="playwright",
                locator_or_element=None,
            )

    async def test_scrolls_element_into_view_playwright(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()
        scroll_called = False
        mock_locator = MagicMock()

        async def mock_evaluate(fn, behavior):
            nonlocal scroll_called
            scroll_called = True
            return True

        mock_locator.evaluate = mock_evaluate

        result = await scroll_into_view(
            page=page,
            engine="playwright",
            locator_or_element=mock_locator,
            log=log,
            verify=False,
        )

        assert result.scrolled is True
        assert scroll_called is True

    async def test_uses_smooth_behavior_by_default(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()
        received_behavior = None
        mock_locator = MagicMock()

        async def mock_evaluate(fn, behavior):
            nonlocal received_behavior
            received_behavior = behavior
            return True

        mock_locator.evaluate = mock_evaluate

        await scroll_into_view(
            page=page,
            engine="playwright",
            locator_or_element=mock_locator,
            log=log,
            verify=False,
        )

        assert received_behavior == "smooth"

    async def test_uses_instant_behavior_when_specified(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()
        received_behavior = None
        mock_locator = MagicMock()

        async def mock_evaluate(fn, behavior):
            nonlocal received_behavior
            received_behavior = behavior
            return True

        mock_locator.evaluate = mock_evaluate

        await scroll_into_view(
            page=page,
            engine="playwright",
            locator_or_element=mock_locator,
            behavior="instant",
            log=log,
            verify=False,
        )

        assert received_behavior == "instant"

    async def test_handles_navigation_error(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()
        mock_locator = MagicMock()
        mock_locator.evaluate = AsyncMock(
            side_effect=Exception("Execution context was destroyed")
        )

        result = await scroll_into_view(
            page=page,
            engine="playwright",
            locator_or_element=mock_locator,
            log=log,
            verify=False,
        )

        assert result.scrolled is False
        assert result.verified is False


# ---------------------------------------------------------------------------
# needs_scrolling
# ---------------------------------------------------------------------------
class TestNeedsScrolling:
    async def test_raises_when_locator_not_provided(self):
        page = create_mock_playwright_page()

        with pytest.raises(ValueError, match="locator_or_element is required"):
            await needs_scrolling(
                page=page,
                engine="playwright",
                locator_or_element=None,
            )

    async def test_returns_true_when_scrolling_needed(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.evaluate = AsyncMock(return_value=True)

        result = await needs_scrolling(
            page=page,
            engine="playwright",
            locator_or_element=mock_locator,
        )

        assert result is True

    async def test_returns_false_when_element_in_view(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.evaluate = AsyncMock(return_value=False)

        result = await needs_scrolling(
            page=page,
            engine="playwright",
            locator_or_element=mock_locator,
        )

        assert result is False

    async def test_handles_navigation_error(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.evaluate = AsyncMock(
            side_effect=Exception("Execution context was destroyed")
        )

        result = await needs_scrolling(
            page=page,
            engine="playwright",
            locator_or_element=mock_locator,
        )

        assert result is False


# ---------------------------------------------------------------------------
# scroll_into_view_if_needed
# ---------------------------------------------------------------------------
class TestScrollIntoViewIfNeeded:
    async def test_raises_when_locator_not_provided(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()

        async def wait_fn(ms, reason):
            return None

        with pytest.raises(ValueError, match="locator_or_element is required"):
            await scroll_into_view_if_needed(
                page=page,
                engine="playwright",
                wait_fn=wait_fn,
                log=log,
                locator_or_element=None,
            )

    async def test_skips_when_element_in_view(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()

        async def wait_fn(ms, reason):
            return None

        mock_locator = MagicMock()
        mock_locator.evaluate = AsyncMock(return_value=False)  # doesn't need scrolling

        result = await scroll_into_view_if_needed(
            page=page,
            engine="playwright",
            wait_fn=wait_fn,
            log=log,
            locator_or_element=mock_locator,
        )

        assert result.scrolled is False
        assert result.skipped is True
        assert result.verified is True

    async def test_scrolls_when_needed(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()

        async def wait_fn(ms, reason):
            return None

        call_count = 0
        mock_locator = MagicMock()

        async def mock_evaluate(fn, arg):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return True  # needs scrolling
            return True  # in viewport after scroll

        mock_locator.evaluate = mock_evaluate

        result = await scroll_into_view_if_needed(
            page=page,
            engine="playwright",
            wait_fn=wait_fn,
            log=log,
            locator_or_element=mock_locator,
            verify=False,
        )

        assert result.scrolled is True
        assert result.skipped is False
