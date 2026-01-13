"""Tests for page trigger manager."""

import re

from browser_commander.core.page_trigger_manager import (
    ActionStoppedError,
    all_conditions,
    any_condition,
    is_action_stopped_error,
    make_url_condition,
    not_condition,
)


class TestActionStoppedError:
    """Tests for ActionStoppedError."""

    def test_is_exception(self) -> None:
        """Should be an exception."""
        error = ActionStoppedError("Test error")
        assert isinstance(error, Exception)

    def test_has_message(self) -> None:
        """Should have message."""
        error = ActionStoppedError("Test message")
        assert str(error) == "Test message"


class TestIsActionStoppedError:
    """Tests for is_action_stopped_error function."""

    def test_returns_true_for_action_stopped_error(self) -> None:
        """Should return True for ActionStoppedError."""
        error = ActionStoppedError("Action stopped")
        assert is_action_stopped_error(error) is True

    def test_returns_false_for_regular_error(self) -> None:
        """Should return False for regular error."""
        error = Exception("Some error")
        assert is_action_stopped_error(error) is False


class TestMakeUrlCondition:
    """Tests for make_url_condition function."""

    def test_matches_exact_url(self) -> None:
        """Should match exact URL."""
        condition = make_url_condition("https://example.com")
        assert condition("https://example.com") is True
        assert condition("https://other.com") is False

    def test_matches_wildcard_pattern(self) -> None:
        """Should match wildcard pattern."""
        condition = make_url_condition("https://example.com/*")
        assert condition("https://example.com/page") is True
        assert condition("https://example.com/") is True
        assert condition("https://other.com/page") is False

    def test_matches_regex_pattern(self) -> None:
        """Should match regex pattern."""
        condition = make_url_condition(re.compile(r"https://example\.com/\d+"))
        assert condition("https://example.com/123") is True
        assert condition("https://example.com/abc") is False

    def test_accepts_callable(self) -> None:
        """Should accept callable as condition."""

        def custom_condition(url):
            return url.startswith("https://")

        condition = make_url_condition(custom_condition)
        assert condition("https://example.com") is True
        assert condition("http://example.com") is False


class TestAllConditions:
    """Tests for all_conditions function."""

    def test_returns_true_when_all_conditions_pass(self) -> None:
        """Should return True when all conditions pass."""
        condition = all_conditions(
            lambda url: url.startswith("https://"),
            lambda url: "example" in url,
        )
        assert condition("https://example.com") is True

    def test_returns_false_when_any_condition_fails(self) -> None:
        """Should return False when any condition fails."""
        condition = all_conditions(
            lambda url: url.startswith("https://"),
            lambda url: "other" in url,
        )
        assert condition("https://example.com") is False


class TestAnyCondition:
    """Tests for any_condition function."""

    def test_returns_true_when_any_condition_passes(self) -> None:
        """Should return True when any condition passes."""
        condition = any_condition(
            lambda url: url.startswith("http://"),
            lambda url: "example" in url,
        )
        assert condition("https://example.com") is True

    def test_returns_false_when_all_conditions_fail(self) -> None:
        """Should return False when all conditions fail."""
        condition = any_condition(
            lambda url: url.startswith("http://"),
            lambda url: "other" in url,
        )
        assert condition("https://example.com") is False


class TestNotCondition:
    """Tests for not_condition function."""

    def test_negates_condition(self) -> None:
        """Should negate condition."""
        condition = not_condition(lambda url: url.startswith("https://"))
        assert condition("https://example.com") is False
        assert condition("http://example.com") is True
