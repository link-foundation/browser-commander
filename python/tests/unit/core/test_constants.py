"""Tests for core constants."""

from browser_commander.core.constants import CHROME_ARGS, TIMING


class TestChromeArgs:
    """Tests for CHROME_ARGS constant."""

    def test_is_list(self) -> None:
        """Should be a list."""
        assert isinstance(CHROME_ARGS, list)

    def test_contains_expected_arguments(self) -> None:
        """Should contain expected browser arguments."""
        assert "--disable-infobars" in CHROME_ARGS
        assert "--no-first-run" in CHROME_ARGS
        assert "--no-default-browser-check" in CHROME_ARGS

    def test_contains_crash_related_flags(self) -> None:
        """Should contain crash-related flags."""
        assert "--disable-session-crashed-bubble" in CHROME_ARGS
        assert "--hide-crash-restore-bubble" in CHROME_ARGS
        assert "--disable-crash-restore" in CHROME_ARGS

    def test_has_minimum_arguments(self) -> None:
        """Should have at least 5 arguments."""
        assert len(CHROME_ARGS) >= 5


class TestTiming:
    """Tests for TIMING constant."""

    def test_is_dict(self) -> None:
        """Should be a dictionary."""
        assert isinstance(TIMING, dict)

    def test_has_scroll_animation_wait(self) -> None:
        """Should have SCROLL_ANIMATION_WAIT key."""
        assert "SCROLL_ANIMATION_WAIT" in TIMING
        assert isinstance(TIMING["SCROLL_ANIMATION_WAIT"], int)
        assert TIMING["SCROLL_ANIMATION_WAIT"] > 0

    def test_has_default_wait_after_scroll(self) -> None:
        """Should have DEFAULT_WAIT_AFTER_SCROLL key."""
        assert "DEFAULT_WAIT_AFTER_SCROLL" in TIMING
        assert isinstance(TIMING["DEFAULT_WAIT_AFTER_SCROLL"], int)
        assert TIMING["DEFAULT_WAIT_AFTER_SCROLL"] > 0

    def test_has_visibility_check_timeout(self) -> None:
        """Should have VISIBILITY_CHECK_TIMEOUT key."""
        assert "VISIBILITY_CHECK_TIMEOUT" in TIMING
        assert isinstance(TIMING["VISIBILITY_CHECK_TIMEOUT"], int)
        assert TIMING["VISIBILITY_CHECK_TIMEOUT"] > 0

    def test_has_default_timeout(self) -> None:
        """Should have DEFAULT_TIMEOUT key."""
        assert "DEFAULT_TIMEOUT" in TIMING
        assert isinstance(TIMING["DEFAULT_TIMEOUT"], int)
        assert TIMING["DEFAULT_TIMEOUT"] >= 1000

    def test_has_verification_timeout(self) -> None:
        """Should have VERIFICATION_TIMEOUT key."""
        assert "VERIFICATION_TIMEOUT" in TIMING
        assert isinstance(TIMING["VERIFICATION_TIMEOUT"], int)
        assert TIMING["VERIFICATION_TIMEOUT"] > 0

    def test_has_verification_retry_interval(self) -> None:
        """Should have VERIFICATION_RETRY_INTERVAL key."""
        assert "VERIFICATION_RETRY_INTERVAL" in TIMING
        assert isinstance(TIMING["VERIFICATION_RETRY_INTERVAL"], int)
        assert TIMING["VERIFICATION_RETRY_INTERVAL"] > 0

    def test_reasonable_timeout_values(self) -> None:
        """Should have reasonable timeout values."""
        # Verification retry should be shorter than verification timeout
        assert TIMING["VERIFICATION_RETRY_INTERVAL"] < TIMING["VERIFICATION_TIMEOUT"]
        # Scroll animation wait should be relatively short
        assert TIMING["SCROLL_ANIMATION_WAIT"] < 1000
