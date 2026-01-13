"""High-level modules for browser-commander."""

from __future__ import annotations

from browser_commander.high_level.universal_logic import (
    check_and_clear_flag,
    find_toggle_button,
    install_click_listener,
    wait_for_url_condition,
)

__all__ = [
    "check_and_clear_flag",
    "find_toggle_button",
    "install_click_listener",
    "wait_for_url_condition",
]
