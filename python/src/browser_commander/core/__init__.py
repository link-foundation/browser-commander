"""Core infrastructure modules for browser-commander."""

from __future__ import annotations

from browser_commander.core.constants import CHROME_ARGS, TIMING
from browser_commander.core.engine_adapter import (
    EngineAdapter,
    PlaywrightAdapter,
    SeleniumAdapter,
    create_engine_adapter,
)
from browser_commander.core.engine_detection import detect_engine
from browser_commander.core.logger import Logger, create_logger, is_verbose_enabled
from browser_commander.core.navigation_manager import (
    NavigationManager,
    create_navigation_manager,
)
from browser_commander.core.navigation_safety import (
    NavigationError,
    is_navigation_error,
    is_timeout_error,
)
from browser_commander.core.network_tracker import (
    NetworkTracker,
    create_network_tracker,
)
from browser_commander.core.page_trigger_manager import (
    ActionStoppedError,
    PageTriggerManager,
    all_conditions,
    any_condition,
    is_action_stopped_error,
    make_url_condition,
    not_condition,
)

__all__ = [
    "CHROME_ARGS",
    "TIMING",
    "ActionStoppedError",
    "EngineAdapter",
    "Logger",
    "NavigationError",
    "NavigationManager",
    "NetworkTracker",
    "PageTriggerManager",
    "PlaywrightAdapter",
    "SeleniumAdapter",
    "all_conditions",
    "any_condition",
    "create_engine_adapter",
    "create_logger",
    "create_navigation_manager",
    "create_network_tracker",
    "detect_engine",
    "is_action_stopped_error",
    "is_navigation_error",
    "is_timeout_error",
    "is_verbose_enabled",
    "make_url_condition",
    "not_condition",
]
