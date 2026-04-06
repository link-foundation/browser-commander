"""DialogManager - Centralized dialog/alert event handling.

This module provides:
- Unified dialog event handling for Playwright and Selenium
- Session-aware handler registration
- Support for alert, confirm, prompt, and beforeunload dialogs

Playwright exposes page.on('dialog', handler) with a Dialog object.
Selenium requires the Alert API (driver.switch_to.alert).
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable

from browser_commander.core.engine_detection import EngineType
from browser_commander.core.logger import Logger


class DialogManager:
    """Manage dialog events across browser engines.

    Supports Playwright's native dialog event API.
    For Selenium, dialog handling is done via driver.switch_to.alert.
    """

    def __init__(
        self,
        page: Any,
        engine: EngineType,
        log: Logger,
    ) -> None:
        """Initialize DialogManager.

        Args:
            page: Playwright page or Selenium WebDriver
            engine: Engine type ('playwright' or 'selenium')
            log: Logger instance
        """
        if page is None:
            raise ValueError("page is required")

        self.page = page
        self.engine = engine
        self.log = log

        self._handlers: list[Callable] = []
        self._is_listening = False

    async def _handle_dialog(self, dialog: Any) -> None:
        """Internal dialog handler dispatched to all user handlers.

        If no handlers are registered, the dialog is auto-dismissed.
        Errors in individual handlers are caught and logged.

        Args:
            dialog: Playwright Dialog object
        """
        # Retrieve type and message (support both property and callable forms)
        dialog_type = dialog.type if isinstance(dialog.type, str) else dialog.type()
        dialog_message = (
            dialog.message if isinstance(dialog.message, str) else dialog.message()
        )

        self.log.debug(
            lambda: f'💬 Dialog event: type="{dialog_type}", message="{dialog_message}"'
        )

        if not self._handlers:
            self.log.debug(
                lambda: (
                    f'⚠️  No dialog handlers registered — auto-dismissing "{dialog_type}" dialog'
                )
            )
            try:
                await dialog.dismiss()
            except Exception:
                self.log.debug(lambda: "⚠️  Failed to auto-dismiss dialog")
            return

        handled = False
        for fn in self._handlers:
            try:
                result = fn(dialog)
                if asyncio.iscoroutine(result):
                    await result
                handled = True
            except Exception:
                self.log.debug(lambda: "⚠️  Error in dialog handler")

        if not handled:
            self.log.debug(
                lambda: (
                    f'⚠️  All dialog handlers failed — auto-dismissing "{dialog_type}" dialog'
                )
            )
            try:
                await dialog.dismiss()
            except Exception:
                self.log.debug(lambda: "⚠️  Failed to auto-dismiss dialog")

    def on_dialog(self, handler: Callable) -> None:
        """Add a dialog event handler.

        The handler receives a dialog object with:
        - dialog.type - 'alert' | 'confirm' | 'prompt' | 'beforeunload'
        - dialog.message - The dialog message text
        - dialog.accept(text=None) - Accept/confirm the dialog
        - dialog.dismiss() - Dismiss/cancel the dialog

        Both sync and async handlers are supported.

        Args:
            handler: Callable receiving a dialog object
        """
        if not callable(handler):
            raise TypeError("Dialog handler must be callable")
        self._handlers.append(handler)
        self.log.debug(
            lambda: f"🔌 Dialog handler registered (total: {len(self._handlers)})"
        )

    def off_dialog(self, handler: Callable) -> None:
        """Remove a dialog event handler.

        Args:
            handler: The handler to remove
        """
        try:
            self._handlers.remove(handler)
            self.log.debug(
                lambda: f"🔌 Dialog handler removed (remaining: {len(self._handlers)})"
            )
        except ValueError:
            pass

    def clear_dialog_handlers(self) -> None:
        """Remove all dialog event handlers."""
        self._handlers.clear()
        self.log.debug(lambda: "🔌 All dialog handlers cleared")

    def start_listening(self) -> None:
        """Start listening for dialog events on the page."""
        if self._is_listening:
            return

        if self.engine == "playwright":
            self.page.on("dialog", self._handle_dialog)

        self._is_listening = True
        self.log.debug(lambda: "🔌 Dialog manager started")

    def stop_listening(self) -> None:
        """Stop listening for dialog events on the page."""
        if not self._is_listening:
            return

        if self.engine == "playwright":
            # Playwright uses remove_listener to unregister
            if hasattr(self.page, "remove_listener"):
                self.page.remove_listener("dialog", self._handle_dialog)
            elif hasattr(self.page, "off"):
                self.page.off("dialog", self._handle_dialog)

        self._is_listening = False
        self.log.debug(lambda: "🔌 Dialog manager stopped")
