"""Tests for navigation safety."""

from browser_commander.core.navigation_safety import (
    is_navigation_error,
    is_timeout_error,
)


class TestIsNavigationError:
    """Tests for is_navigation_error function."""

    def test_returns_true_for_execution_context_destroyed(self) -> None:
        """Should return True for 'Execution context was destroyed'."""
        error = Exception("Execution context was destroyed")
        assert is_navigation_error(error) is True

    def test_returns_true_for_frame_detached(self) -> None:
        """Should return True for 'Frame was detached'."""
        error = Exception("Frame was detached")
        assert is_navigation_error(error) is True

    def test_returns_true_for_target_crashed(self) -> None:
        """Should return True for 'target crashed'."""
        error = Exception("target crashed")
        assert is_navigation_error(error) is True

    def test_returns_true_for_target_closed(self) -> None:
        """Should return True for 'Target closed'."""
        error = Exception("Target closed")
        assert is_navigation_error(error) is True

    def test_returns_true_for_navigation_interrupted(self) -> None:
        """Should return True for 'Navigation interrupted'."""
        error = Exception("Navigation interrupted by another navigation")
        assert is_navigation_error(error) is True

    def test_returns_false_for_regular_error(self) -> None:
        """Should return False for regular error."""
        error = Exception("Some other error")
        assert is_navigation_error(error) is False


class TestIsTimeoutError:
    """Tests for is_timeout_error function."""

    def test_returns_true_for_timeout_exceeded(self) -> None:
        """Should return True for 'Timeout exceeded'."""
        error = Exception("Timeout 30000ms exceeded")
        assert is_timeout_error(error) is True

    def test_returns_true_for_timed_out(self) -> None:
        """Should return True for 'Timed out'."""
        error = Exception("Timed out waiting for element")
        assert is_timeout_error(error) is True

    def test_returns_true_for_waiting_timed_out(self) -> None:
        """Should return True for 'Waiting... timed out'."""
        error = Exception("Waiting for locator('.btn') timed out")
        assert is_timeout_error(error) is True

    def test_returns_false_for_regular_error(self) -> None:
        """Should return False for regular error."""
        error = Exception("Element not found")
        assert is_timeout_error(error) is False
