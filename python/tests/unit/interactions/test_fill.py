"""Unit tests for fill interactions."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from browser_commander.interactions.fill import (
    FillVerificationResult,
    check_if_element_empty,
    default_fill_verification,
    fill_text_area,
    perform_fill,
    verify_fill,
)
from tests.helpers.mocks import create_mock_logger, create_mock_playwright_page


# ---------------------------------------------------------------------------
# default_fill_verification
# ---------------------------------------------------------------------------
class TestDefaultFillVerification:
    async def test_verifies_exact_match(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.input_value = AsyncMock(return_value="test value")

        result = await default_fill_verification(
            page=page,
            engine="playwright",
            locator_or_element=mock_locator,
            expected_text="test value",
        )

        assert result.verified is True
        assert result.actual_value == "test value"

    async def test_verifies_partial_match(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.input_value = AsyncMock(return_value="test value with extra")

        result = await default_fill_verification(
            page=page,
            engine="playwright",
            locator_or_element=mock_locator,
            expected_text="test value",
        )

        assert result.verified is True

    async def test_fails_on_mismatch(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.input_value = AsyncMock(return_value="different value")

        result = await default_fill_verification(
            page=page,
            engine="playwright",
            locator_or_element=mock_locator,
            expected_text="expected value",
        )

        assert result.verified is False


# ---------------------------------------------------------------------------
# verify_fill
# ---------------------------------------------------------------------------
class TestVerifyFill:
    async def test_verifies_fill_with_retry(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()

        async def custom_verify_fn(**kwargs):
            return FillVerificationResult(verified=True, actual_value="test")

        result = await verify_fill(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            expected_text="test",
            verify_fn=custom_verify_fn,
            timeout=100,
            log=log,
        )

        assert result.verified is True
        assert result.attempts >= 1

    async def test_fails_after_timeout(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()

        async def always_fail(**kwargs):
            return FillVerificationResult(verified=False, actual_value="different")

        result = await verify_fill(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            expected_text="expected",
            verify_fn=always_fail,
            timeout=50,
            retry_interval=10,
            log=log,
        )

        assert result.verified is False
        assert result.attempts >= 1


# ---------------------------------------------------------------------------
# check_if_element_empty
# ---------------------------------------------------------------------------
class TestCheckIfElementEmpty:
    async def test_raises_when_locator_not_provided(self):
        page = create_mock_playwright_page()

        with pytest.raises(ValueError, match="locator_or_element is required"):
            await check_if_element_empty(
                page=page,
                engine="playwright",
                locator_or_element=None,
            )

    async def test_returns_true_for_empty_element(self):
        page = create_mock_playwright_page()
        adapter = MagicMock()
        adapter.get_input_value = AsyncMock(return_value="")

        result = await check_if_element_empty(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            adapter=adapter,
        )

        assert result is True

    async def test_returns_true_for_whitespace_only(self):
        page = create_mock_playwright_page()
        adapter = MagicMock()
        adapter.get_input_value = AsyncMock(return_value="   ")

        result = await check_if_element_empty(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            adapter=adapter,
        )

        assert result is True

    async def test_returns_false_for_element_with_content(self):
        page = create_mock_playwright_page()
        adapter = MagicMock()
        adapter.get_input_value = AsyncMock(return_value="some content")

        result = await check_if_element_empty(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            adapter=adapter,
        )

        assert result is False

    async def test_handles_navigation_error(self):
        page = create_mock_playwright_page()
        adapter = MagicMock()
        adapter.get_input_value = AsyncMock(
            side_effect=Exception("Execution context was destroyed")
        )

        result = await check_if_element_empty(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            adapter=adapter,
        )

        assert result is True


# ---------------------------------------------------------------------------
# perform_fill
# ---------------------------------------------------------------------------
class TestPerformFill:
    async def test_raises_when_text_not_provided(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()

        with pytest.raises(ValueError, match="text is required"):
            await perform_fill(
                page=page,
                engine="playwright",
                locator_or_element=MagicMock(),
                text="",
                log=log,
            )

    async def test_raises_when_locator_not_provided(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()

        with pytest.raises(ValueError, match="locator_or_element is required"):
            await perform_fill(
                page=page,
                engine="playwright",
                locator_or_element=None,
                text="test",
                log=log,
            )

    async def test_fill_with_typing_simulation(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()
        type_called = False
        adapter = MagicMock()

        async def mock_type(el, text):
            nonlocal type_called
            type_called = True

        adapter.type = mock_type
        adapter.get_input_value = AsyncMock(return_value="test text")

        result = await perform_fill(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            text="test text",
            simulate_typing=True,
            verify=False,
            log=log,
            adapter=adapter,
        )

        assert result.filled is True
        assert type_called is True

    async def test_fill_without_typing_simulation(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()
        fill_called = False
        adapter = MagicMock()

        async def mock_fill(el, text):
            nonlocal fill_called
            fill_called = True

        adapter.fill = mock_fill
        adapter.get_input_value = AsyncMock(return_value="test text")

        result = await perform_fill(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            text="test text",
            simulate_typing=False,
            verify=False,
            log=log,
            adapter=adapter,
        )

        assert result.filled is True
        assert fill_called is True

    async def test_handles_navigation_error(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()
        adapter = MagicMock()
        adapter.type = AsyncMock(
            side_effect=Exception("Execution context was destroyed")
        )

        result = await perform_fill(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            text="test",
            simulate_typing=True,
            verify=False,
            log=log,
            adapter=adapter,
        )

        assert result.filled is False


# ---------------------------------------------------------------------------
# fill_text_area
# ---------------------------------------------------------------------------
class TestFillTextArea:
    async def test_raises_when_selector_not_provided(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()

        async def wait_fn(ms, reason):
            return None

        with pytest.raises(ValueError, match="selector and text are required"):
            await fill_text_area(
                page=page,
                engine="playwright",
                wait_fn=wait_fn,
                log=log,
                selector="",
                text="test",
            )

    async def test_raises_when_text_not_provided(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()

        async def wait_fn(ms, reason):
            return None

        with pytest.raises(ValueError, match="selector and text are required"):
            await fill_text_area(
                page=page,
                engine="playwright",
                wait_fn=wait_fn,
                log=log,
                selector="textarea",
                text="",
            )
