"""Fixtures for the managed download tests (issue #88).

The fakes speak exactly the part of Playwright's and CDP's download APIs the
manager uses, so the tests exercise the real event plumbing without needing a
browser.
"""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path
from typing import Any


class FakeDownload:
    """A Playwright download whose bytes are already staged on disk."""

    def __init__(
        self,
        *,
        directory: str,
        suggested_filename: str,
        body: bytes | str = b"hello",
        url: str = "https://example.com/file",
        failure: str | None = None,
    ) -> None:
        """Stage a download's bytes.

        Args:
            directory: Directory to stage the bytes in
            suggested_filename: Name the page suggested
            body: File contents
            url: Source URL
            failure: Engine failure text, when the download failed
        """
        self.url = url
        self.suggested_filename = suggested_filename
        self.staged_path = Path(directory, f"staged-{uuid.uuid4().hex}")
        self._failure = failure
        if failure is None:
            data = body.encode("utf-8") if isinstance(body, str) else body
            self.staged_path.write_bytes(data)

    async def failure(self) -> str | None:
        """Report the engine's failure text.

        Returns:
            The failure text, or ``None`` when the download succeeded
        """
        return self._failure

    async def path(self) -> str:
        """Report where the engine staged the bytes.

        Returns:
            Absolute path of the staged file
        """
        return str(self.staged_path)


class FakeEmitter:
    """The subscription surface Playwright objects expose."""

    def __init__(self) -> None:
        """Start with no listeners."""
        self._listeners: dict[str, list[Any]] = {}

    def on(self, event: str, listener: Any) -> None:
        """Register a listener.

        Args:
            event: Event name
            listener: Callback
        """
        self._listeners.setdefault(event, []).append(listener)

    def remove_listener(self, event: str, listener: Any) -> None:
        """Remove a listener.

        Args:
            event: Event name
            listener: Callback registered earlier
        """
        if listener in self._listeners.get(event, []):
            self._listeners[event].remove(listener)

    def emit(self, event: str, payload: Any) -> None:
        """Hand a payload to every listener.

        Args:
            event: Event name
            payload: Value passed to the listeners
        """
        for listener in list(self._listeners.get(event, [])):
            listener(payload)

    def listener_count(self, event: str) -> int:
        """Count the listeners for an event.

        Args:
            event: Event name

        Returns:
            How many listeners are registered
        """
        return len(self._listeners.get(event, []))


class FakeContext(FakeEmitter):
    """A browser context that emits Playwright download events."""

    async def emit_download(self, download: FakeDownload) -> None:
        """Emit a download and let the manager's handler start.

        Args:
            download: The download to announce
        """
        self.emit("download", download)
        # The manager's handler is scheduled, not awaited, by the engine.
        await asyncio.sleep(0)


class FakeCdpSession(FakeEmitter):
    """A CDP session that speaks the Browser download domain."""

    def __init__(self) -> None:
        """Record nothing yet."""
        super().__init__()
        self.sent: list[dict[str, Any]] = []
        self.detached = False

    async def send(self, method: str, params: dict[str, Any]) -> None:
        """Record a CDP command.

        Args:
            method: CDP method name
            params: Command parameters
        """
        self.sent.append({"method": method, "params": params})

    async def detach(self) -> None:
        """Record that the session was detached."""
        self.detached = True


class FakePage:
    """A page that belongs to a context, as Playwright's page does."""

    def __init__(self, context: Any) -> None:
        """Bind the page to its context.

        Args:
            context: The context this page belongs to
        """
        self.context = context

    def locator(self, selector: str) -> Any:
        """Stand in for Playwright's locator factory.

        Args:
            selector: Ignored

        Returns:
            A placeholder locator
        """
        return object()

    async def goto(self, url: str) -> None:
        """Stand in for Playwright's navigation.

        Args:
            url: Ignored
        """


class FakeBrowser:
    """A Playwright browser that hands out browser-wide CDP sessions."""

    def __init__(self, session: FakeCdpSession, context: Any = None) -> None:
        """Bind the browser to the session it opens.

        Args:
            session: Session returned by ``new_browser_cdp_session``
            context: Default context, when the test needs one
        """
        self._session = session
        self.contexts = [context] if context is not None else []

    async def new_browser_cdp_session(self) -> FakeCdpSession:
        """Open the browser-wide CDP session.

        Returns:
            The fake session
        """
        return self._session
