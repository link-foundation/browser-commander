"""Unit tests for high-level universal logic."""

from __future__ import annotations

import pytest

from browser_commander.high_level.universal_logic import (
    check_and_clear_flag,
    find_toggle_button,
    install_click_listener,
    wait_for_url_condition,
)


# ---------------------------------------------------------------------------
# wait_for_url_condition
# ---------------------------------------------------------------------------
class TestWaitForUrlCondition:
    async def test_returns_true_when_target_url_reached(self):
        call_count = 0

        def get_url():
            nonlocal call_count
            call_count += 1
            if call_count >= 2:
                return "https://example.com/target"
            return "https://example.com/start"

        async def wait_fn(ms, reason):
            return None

        async def evaluate_fn(fn, args):
            return None

        result = await wait_for_url_condition(
            get_url=get_url,
            wait_fn=wait_fn,
            evaluate_fn=evaluate_fn,
            target_url="https://example.com/target",
            polling_interval=1,
        )

        assert result is True

    async def test_returns_none_when_page_is_closed(self):
        page_open = True

        def get_url():
            return "https://example.com/start"

        async def wait_fn(ms, reason):
            nonlocal page_open
            page_open = False

        async def evaluate_fn(fn, args):
            return None

        def page_closed_callback():
            return not page_open

        result = await wait_for_url_condition(
            get_url=get_url,
            wait_fn=wait_fn,
            evaluate_fn=evaluate_fn,
            target_url="https://example.com/target",
            page_closed_callback=page_closed_callback,
            polling_interval=1,
        )

        assert result is None

    async def test_returns_custom_check_result(self):
        def get_url():
            return "https://example.com/page"

        async def wait_fn(ms, reason):
            return None

        async def evaluate_fn(fn, args):
            return None

        check_called = False

        async def custom_check(url):
            nonlocal check_called
            check_called = True
            return "custom result"

        result = await wait_for_url_condition(
            get_url=get_url,
            wait_fn=wait_fn,
            evaluate_fn=evaluate_fn,
            target_url="https://example.com/never",
            custom_check=custom_check,
            polling_interval=1,
        )

        assert check_called is True
        assert result == "custom result"

    async def test_continues_when_custom_check_returns_none(self):
        call_count = 0

        def get_url():
            nonlocal call_count
            call_count += 1
            if call_count >= 3:
                return "https://example.com/target"
            return "https://example.com/start"

        async def wait_fn(ms, reason):
            return None

        async def evaluate_fn(fn, args):
            return None

        async def custom_check(url):
            return None  # Continue waiting

        result = await wait_for_url_condition(
            get_url=get_url,
            wait_fn=wait_fn,
            evaluate_fn=evaluate_fn,
            target_url="https://example.com/target",
            custom_check=custom_check,
            polling_interval=1,
        )

        assert result is True

    async def test_handles_errors_gracefully(self):
        call_count = 0

        def get_url():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("Temporary error")
            if call_count >= 3:
                return "https://example.com/target"
            return "https://example.com/start"

        async def wait_fn(ms, reason):
            return None

        async def evaluate_fn(fn, args):
            return None

        result = await wait_for_url_condition(
            get_url=get_url,
            wait_fn=wait_fn,
            evaluate_fn=evaluate_fn,
            target_url="https://example.com/target",
            polling_interval=1,
        )

        assert result is True


# ---------------------------------------------------------------------------
# install_click_listener
# ---------------------------------------------------------------------------
class TestInstallClickListener:
    async def test_installs_click_listener(self):
        evaluated_code = None
        evaluated_args = None

        async def evaluate_fn(code, args):
            nonlocal evaluated_code, evaluated_args
            evaluated_code = code
            evaluated_args = args
            return True

        result = await install_click_listener(
            evaluate_fn=evaluate_fn,
            button_text="Submit",
            storage_key="submit_clicked",
        )

        assert result is True
        assert evaluated_code is not None
        assert evaluated_args == ["Submit", "submit_clicked"]

    async def test_handles_navigation_error(self):
        async def evaluate_fn(code, args):
            raise Exception("Execution context was destroyed")

        result = await install_click_listener(
            evaluate_fn=evaluate_fn,
            button_text="Submit",
            storage_key="submit_clicked",
        )

        assert result is False


# ---------------------------------------------------------------------------
# check_and_clear_flag
# ---------------------------------------------------------------------------
class TestCheckAndClearFlag:
    async def test_returns_true_when_flag_set(self):
        async def evaluate_fn(code, args):
            return True

        result = await check_and_clear_flag(
            evaluate_fn=evaluate_fn,
            storage_key="my_flag",
        )

        assert result is True

    async def test_returns_false_when_flag_not_set(self):
        async def evaluate_fn(code, args):
            return False

        result = await check_and_clear_flag(
            evaluate_fn=evaluate_fn,
            storage_key="my_flag",
        )

        assert result is False

    async def test_handles_navigation_error(self):
        async def evaluate_fn(code, args):
            raise Exception("Execution context was destroyed")

        result = await check_and_clear_flag(
            evaluate_fn=evaluate_fn,
            storage_key="my_flag",
        )

        assert result is False


# ---------------------------------------------------------------------------
# find_toggle_button
# ---------------------------------------------------------------------------
class TestFindToggleButton:
    async def test_finds_by_data_qa_selector(self):
        async def count_fn(selector):
            if selector == "[data-qa='toggle-btn']":
                return 1
            return 0

        async def find_by_text_fn(text, selector):
            return f"{selector}:has-text('{text}')"

        result = await find_toggle_button(
            count_fn=count_fn,
            find_by_text_fn=find_by_text_fn,
            data_qa_selectors=["[data-qa='toggle-btn']", "[data-qa='menu-btn']"],
        )

        assert result == "[data-qa='toggle-btn']"

    async def test_finds_by_text_when_data_qa_fails(self):
        async def count_fn(selector):
            if "Toggle" in selector:
                return 1
            return 0

        async def find_by_text_fn(text, element_type):
            return f"{element_type}:has-text('{text}')"

        result = await find_toggle_button(
            count_fn=count_fn,
            find_by_text_fn=find_by_text_fn,
            data_qa_selectors=[],
            text_to_find="Toggle",
            element_types=["button", "a"],
        )

        assert result is not None
        assert "Toggle" in result

    async def test_returns_none_when_not_found(self):
        async def count_fn(selector):
            return 0

        async def find_by_text_fn(text, element_type):
            return f"{element_type}:has-text('{text}')"

        result = await find_toggle_button(
            count_fn=count_fn,
            find_by_text_fn=find_by_text_fn,
            data_qa_selectors=["[data-qa='nonexistent']"],
            text_to_find="Not Found",
        )

        assert result is None
