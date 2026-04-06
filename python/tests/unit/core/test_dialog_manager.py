"""Tests for DialogManager."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from browser_commander.core.dialog_manager import DialogManager
from tests.helpers.mocks import create_mock_logger, create_mock_playwright_page


def create_mock_dialog(
    dialog_type: str = "alert",
    message: str = "Test dialog message",
) -> MagicMock:
    """Create a mock Playwright Dialog object."""
    dialog = MagicMock()
    dialog.type = dialog_type
    dialog.message = message
    dialog.accept = AsyncMock()
    dialog.dismiss = AsyncMock()
    return dialog


class TestCreateDialogManager:
    """Tests for DialogManager creation."""

    def test_raises_when_page_is_none(self) -> None:
        """Should raise ValueError when page is not provided."""
        log = create_mock_logger()
        with pytest.raises(ValueError, match="page is required"):
            DialogManager(page=None, engine="playwright", log=log)

    def test_creates_dialog_manager(self) -> None:
        """Should create dialog manager with expected API."""
        page = create_mock_playwright_page()
        log = create_mock_logger()
        manager = DialogManager(page=page, engine="playwright", log=log)

        assert callable(manager.on_dialog)
        assert callable(manager.off_dialog)
        assert callable(manager.clear_dialog_handlers)
        assert callable(manager.start_listening)
        assert callable(manager.stop_listening)

    def test_start_listening(self) -> None:
        """Should start listening without error."""
        page = create_mock_playwright_page()
        log = create_mock_logger()
        manager = DialogManager(page=page, engine="playwright", log=log)
        manager.start_listening()

    def test_start_listening_idempotent(self) -> None:
        """Should not register handler twice if called twice."""
        page = create_mock_playwright_page()
        log = create_mock_logger()
        manager = DialogManager(page=page, engine="playwright", log=log)
        manager.start_listening()
        manager.start_listening()  # Should not throw

    def test_stop_listening(self) -> None:
        """Should stop listening without error."""
        page = create_mock_playwright_page()
        log = create_mock_logger()
        manager = DialogManager(page=page, engine="playwright", log=log)
        manager.start_listening()
        manager.stop_listening()

    def test_stop_listening_without_start(self) -> None:
        """Should not raise if stop called before start."""
        page = create_mock_playwright_page()
        log = create_mock_logger()
        manager = DialogManager(page=page, engine="playwright", log=log)
        manager.stop_listening()  # Should not raise


class TestOnDialog:
    """Tests for on_dialog handler registration."""

    def test_raises_when_handler_not_callable(self) -> None:
        """Should raise TypeError for non-callable handler."""
        page = create_mock_playwright_page()
        log = create_mock_logger()
        manager = DialogManager(page=page, engine="playwright", log=log)
        with pytest.raises(TypeError, match="handler must be callable"):
            manager.on_dialog("not-callable")  # type: ignore[arg-type]

    @pytest.mark.asyncio
    async def test_registers_async_handler(self) -> None:
        """Should call async handler when dialog event fires."""
        page = create_mock_playwright_page()
        log = create_mock_logger()
        manager = DialogManager(page=page, engine="playwright", log=log)
        manager.start_listening()

        called = False

        async def handler(dialog: MagicMock) -> None:
            nonlocal called
            called = True
            await dialog.dismiss()

        manager.on_dialog(handler)

        dialog = create_mock_dialog(dialog_type="alert", message="Hello!")
        # Trigger via page emit
        page.emit("dialog", dialog)
        await asyncio.sleep(0)  # Yield to allow async handler to run

        # Give a bit of time for async handler
        await asyncio.sleep(0.01)
        assert called
        dialog.dismiss.assert_called_once()

    @pytest.mark.asyncio
    async def test_registers_sync_handler(self) -> None:
        """Should call sync handler when dialog event fires."""
        page = create_mock_playwright_page()
        log = create_mock_logger()
        manager = DialogManager(page=page, engine="playwright", log=log)
        manager.start_listening()

        called = False

        def handler(dialog: MagicMock) -> None:
            nonlocal called
            called = True

        manager.on_dialog(handler)

        dialog = create_mock_dialog()
        page.emit("dialog", dialog)
        await asyncio.sleep(0.01)

        assert called

    @pytest.mark.asyncio
    async def test_passes_dialog_type_and_message(self) -> None:
        """Should receive correct dialog type and message."""
        page = create_mock_playwright_page()
        log = create_mock_logger()
        manager = DialogManager(page=page, engine="playwright", log=log)
        manager.start_listening()

        received_type = None
        received_message = None

        async def handler(dialog: MagicMock) -> None:
            nonlocal received_type, received_message
            received_type = dialog.type
            received_message = dialog.message
            await dialog.accept()

        manager.on_dialog(handler)

        dialog = create_mock_dialog(dialog_type="confirm", message="Are you sure?")
        page.emit("dialog", dialog)
        await asyncio.sleep(0.01)

        assert received_type == "confirm"
        assert received_message == "Are you sure?"
        dialog.accept.assert_called_once()

    @pytest.mark.asyncio
    async def test_accepts_prompt_with_text(self) -> None:
        """Should allow accepting prompts with custom text."""
        page = create_mock_playwright_page()
        log = create_mock_logger()
        manager = DialogManager(page=page, engine="playwright", log=log)
        manager.start_listening()

        async def handler(dialog: MagicMock) -> None:
            await dialog.accept("My answer")

        manager.on_dialog(handler)

        dialog = create_mock_dialog(dialog_type="prompt", message="Enter name:")
        page.emit("dialog", dialog)
        await asyncio.sleep(0.01)

        dialog.accept.assert_called_once_with("My answer")


class TestOffDialog:
    """Tests for off_dialog handler removal."""

    @pytest.mark.asyncio
    async def test_removes_handler(self) -> None:
        """Should not call removed handler."""
        page = create_mock_playwright_page()
        log = create_mock_logger()
        manager = DialogManager(page=page, engine="playwright", log=log)
        manager.start_listening()

        call_count = 0

        async def handler(dialog: MagicMock) -> None:
            nonlocal call_count
            call_count += 1
            await dialog.dismiss()

        manager.on_dialog(handler)

        dialog1 = create_mock_dialog()
        page.emit("dialog", dialog1)
        await asyncio.sleep(0.01)
        assert call_count == 1

        manager.off_dialog(handler)

        dialog2 = create_mock_dialog()
        page.emit("dialog", dialog2)
        await asyncio.sleep(0.01)
        # Handler removed, auto-dismiss should fire
        assert call_count == 1

    def test_does_not_raise_for_nonexistent_handler(self) -> None:
        """Should not raise if handler was not registered."""
        page = create_mock_playwright_page()
        log = create_mock_logger()
        manager = DialogManager(page=page, engine="playwright", log=log)

        async def handler(dialog: MagicMock) -> None:
            pass

        manager.off_dialog(handler)  # Should not raise


class TestClearDialogHandlers:
    """Tests for clear_dialog_handlers."""

    @pytest.mark.asyncio
    async def test_removes_all_handlers(self) -> None:
        """Should not call any handlers after clear."""
        page = create_mock_playwright_page()
        log = create_mock_logger()
        manager = DialogManager(page=page, engine="playwright", log=log)
        manager.start_listening()

        call_count = 0

        async def handler1(dialog: MagicMock) -> None:
            nonlocal call_count
            call_count += 1
            await dialog.dismiss()

        async def handler2(dialog: MagicMock) -> None:
            nonlocal call_count
            call_count += 1

        manager.on_dialog(handler1)
        manager.on_dialog(handler2)
        manager.clear_dialog_handlers()

        dialog = create_mock_dialog()
        page.emit("dialog", dialog)
        await asyncio.sleep(0.01)

        assert call_count == 0
        # Auto-dismiss should have been called
        dialog.dismiss.assert_called_once()


class TestAutoDismiss:
    """Tests for auto-dismiss behavior."""

    @pytest.mark.asyncio
    async def test_auto_dismisses_when_no_handlers(self) -> None:
        """Should auto-dismiss dialog when no handlers registered."""
        page = create_mock_playwright_page()
        log = create_mock_logger()
        manager = DialogManager(page=page, engine="playwright", log=log)
        manager.start_listening()

        dialog = create_mock_dialog(dialog_type="alert", message="Auto!")
        page.emit("dialog", dialog)
        await asyncio.sleep(0.01)

        dialog.dismiss.assert_called_once()

    @pytest.mark.asyncio
    async def test_continues_after_handler_error(self) -> None:
        """Should call subsequent handlers even if one fails."""
        page = create_mock_playwright_page()
        log = create_mock_logger()
        manager = DialogManager(page=page, engine="playwright", log=log)
        manager.start_listening()

        second_called = False

        async def failing_handler(dialog: MagicMock) -> None:
            raise RuntimeError("Handler failed")

        async def second_handler(dialog: MagicMock) -> None:
            nonlocal second_called
            second_called = True
            await dialog.dismiss()

        manager.on_dialog(failing_handler)
        manager.on_dialog(second_handler)

        dialog = create_mock_dialog()
        page.emit("dialog", dialog)
        await asyncio.sleep(0.01)

        assert second_called


class TestIntegrationWithBrowserCommander:
    """Integration tests with BrowserCommander."""

    def test_exposes_on_dialog_on_commander(self) -> None:
        """Commander should expose on_dialog, off_dialog, clear_dialog_handlers."""
        from browser_commander.factory import make_browser_commander

        page = create_mock_playwright_page()
        commander = make_browser_commander(page=page, verbose=False)

        assert callable(commander.on_dialog)
        assert callable(commander.off_dialog)
        assert callable(commander.clear_dialog_handlers)
        assert commander.dialog_manager is not None

    @pytest.mark.asyncio
    async def test_handles_dialog_via_commander(self) -> None:
        """Dialog should be handled via commander.on_dialog."""
        from browser_commander.factory import make_browser_commander

        page = create_mock_playwright_page()
        commander = make_browser_commander(page=page, verbose=False)

        called = False

        async def handler(dialog: MagicMock) -> None:
            nonlocal called
            called = True
            await dialog.dismiss()

        commander.on_dialog(handler)

        dialog = create_mock_dialog(dialog_type="alert", message="Test!")
        page.emit("dialog", dialog)
        await asyncio.sleep(0.01)

        assert called
        dialog.dismiss.assert_called_once()

        await commander.destroy()

    def test_raises_on_dialog_when_disabled(self) -> None:
        """Should raise RuntimeError when enable_dialog_manager=False."""
        from browser_commander.factory import make_browser_commander

        page = create_mock_playwright_page()
        commander = make_browser_commander(
            page=page, verbose=False, enable_dialog_manager=False
        )

        with pytest.raises(RuntimeError, match="enable_dialog_manager"):
            commander.on_dialog(lambda _: None)
