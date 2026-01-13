"""Tests for core logger."""

import os
import sys
from unittest.mock import patch

from browser_commander.core.logger import create_logger, is_verbose_enabled


class TestIsVerboseEnabled:
    """Tests for is_verbose_enabled function."""

    def test_returns_false_when_env_not_set(self) -> None:
        """Should return False when VERBOSE env is not set."""
        with patch.dict(os.environ, {}, clear=True):
            # Also need to filter argv
            original_argv = sys.argv
            sys.argv = ["python", "script.py"]
            try:
                result = is_verbose_enabled()
                assert result is False
            finally:
                sys.argv = original_argv

    def test_returns_true_when_env_is_set(self) -> None:
        """Should return True when VERBOSE env is set."""
        with patch.dict(os.environ, {"VERBOSE": "true"}):
            assert is_verbose_enabled() is True

    def test_returns_true_when_env_is_any_value(self) -> None:
        """Should return True when VERBOSE env is set to any value."""
        with patch.dict(os.environ, {"VERBOSE": "1"}):
            assert is_verbose_enabled() is True

    def test_returns_true_when_verbose_flag_in_argv(self) -> None:
        """Should return True when --verbose flag is in argv."""
        with patch.dict(os.environ, {}, clear=True):
            original_argv = sys.argv
            sys.argv = ["python", "script.py", "--verbose"]
            try:
                assert is_verbose_enabled() is True
            finally:
                sys.argv = original_argv


class TestCreateLogger:
    """Tests for create_logger function."""

    def test_creates_logger_instance(self) -> None:
        """Should create a logger instance."""
        log = create_logger()
        assert log is not None

    def test_creates_logger_with_verbose_disabled_by_default(self) -> None:
        """Should create logger with verbose disabled by default."""
        log = create_logger()
        assert log is not None

    def test_creates_logger_with_verbose_enabled(self) -> None:
        """Should create logger with verbose enabled."""
        log = create_logger(verbose=True)
        assert log is not None

    def test_creates_logger_with_verbose_disabled(self) -> None:
        """Should create logger with verbose disabled."""
        log = create_logger(verbose=False)
        assert log is not None

    def test_has_debug_method(self) -> None:
        """Should have debug method."""
        log = create_logger(verbose=True)
        assert hasattr(log, "debug")
        assert callable(log.debug)

    def test_debug_accepts_callable(self) -> None:
        """Should accept callable for debug method."""
        log = create_logger(verbose=True)
        # Should not raise
        log.debug(lambda: "test message")
