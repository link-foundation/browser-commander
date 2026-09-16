"""Managed, persistent downloads (issue #88).

The manager owns one lifecycle for every download the browser performs -
automated or started by a person - and guarantees three things a caller cannot
get from an engine event alone:

- the file survives the page, context and browser that produced it;
- a download is saved once and reported once, even when a global listener and
  an awaited ``capture()`` both see it;
- a file under its final name is complete and has passed validation.
"""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import itertools
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from browser_commander.core.readiness import Deadline
from browser_commander.downloads.destination import (
    prepare_download_directory,
    resolve_download_directory,
)
from browser_commander.downloads.sources import (
    DownloadFailure,
    attach_cdp_source,
    attach_playwright_source,
    open_browser_cdp_session,
)
from browser_commander.downloads.staging import (
    DEFAULT_STAGING_POLL_INTERVAL,
    DEFAULT_STAGING_TIMEOUT,
)
from browser_commander.downloads.store import (
    DownloadConflict,
    DownloadSource,
    save_download,
)
from browser_commander.downloads.watcher import (
    DEFAULT_POLL_INTERVAL,
    attach_filesystem_watcher,
)


class DownloadEvent:
    """Lifecycle events every download passes through."""

    #: The engine announced a download.
    STARTED = "started"
    #: The bytes are on disk under their final name.
    COMPLETED = "completed"
    #: The download ended in an error.
    FAILED = "failed"
    #: The browser or the person stopped it.
    CANCELLED = "cancelled"


#: How long ``capture()`` waits for a download by default, in milliseconds.
DEFAULT_CAPTURE_TIMEOUT = 30_000

#: Monotonic part of a download ID, so IDs are stable and ordered.
_download_ids = itertools.count(1)


def _now() -> str:
    """Return the current wall-clock time.

    Returns:
        An ISO-8601 timestamp in UTC
    """
    return datetime.now(timezone.utc).isoformat()


@dataclass
class DownloadArtifact:
    """Everything known about one download."""

    id: str
    url: str | None
    suggested_filename: str | None
    state: str
    started_at: str
    completed_at: str | None = None
    path: str | None = None
    mime_type: str | None = None
    bytes: int | None = None
    checksum: str | None = None
    failure: str | None = None
    #: Naming, validation and conflict rules claimed by one ``capture()``.
    filename: Callable[..., Any] | None = field(default=None, repr=False)
    validate: Callable[..., Any] | None = field(default=None, repr=False)
    conflict: str | None = field(default=None, repr=False)


class _Waiter:
    """One armed ``capture()`` waiting for the download it triggered."""

    def __init__(self, armed_at: int, future: asyncio.Future) -> None:
        """Arm a waiter.

        Args:
            armed_at: Number of artifacts seen when the waiter was armed
            future: Future settled with the artifact it claims
        """
        self.armed_at = armed_at
        self.future = future


class DownloadManager:
    """One managed download lifecycle for a browser."""

    def __init__(
        self,
        *,
        directory: str,
        persist: bool = True,
        conflict: str = DownloadConflict.RENAME,
        filename: Callable[..., Any] | None = None,
        validate: Callable[..., Any] | None = None,
        log: Any = None,
        staging_timeout: float = DEFAULT_STAGING_TIMEOUT,
        staging_poll_interval: float = DEFAULT_STAGING_POLL_INTERVAL,
    ) -> None:
        """Create a manager for an already-prepared directory.

        Args:
            directory: Absolute, writable download directory
            persist: Keep files after the browser closes
            conflict: ``rename``, ``overwrite`` or ``error``
            filename: Naming callback for every download
            validate: Validation for every download
            log: Logger
            staging_timeout: Seconds a completed download has to become
                readable on disk before it is reported as failed (issue #92)
            staging_poll_interval: Seconds between readings of the staged file
        """
        self.directory = directory
        self.persist = persist
        self.conflict = conflict
        self._filename = filename
        self._validate = validate
        self._log = log
        self._staging_timeout = staging_timeout
        self._staging_poll_interval = staging_poll_interval

        self._artifacts: list[DownloadArtifact] = []
        self._listeners: dict[str, list[Callable[..., Any]]] = {}
        self._pending: dict[Any, DownloadArtifact] = {}
        self._waiters: list[_Waiter] = []
        self._published: set[str] = set()
        self._in_flight: set[asyncio.Future] = set()
        self._sources: list[Any] = []
        self._cdp_session: Any = None

    # ==================== Observation ====================

    def list(self) -> list[DownloadArtifact]:
        """List every download seen in this session.

        Returns:
            Artifacts in the order they started
        """
        return list(self._artifacts)

    def on(self, event: str, listener: Callable[..., Any]) -> Callable[..., Any]:
        """Call a listener every time an event is published.

        Args:
            event: One of :class:`DownloadEvent`
            listener: Callback receiving the artifact

        Returns:
            The listener, so it can be removed later
        """
        self._listeners.setdefault(event, []).append(listener)
        return listener

    def once(self, event: str, listener: Callable[..., Any]) -> Callable[..., Any]:
        """Call a listener for the next event only.

        Args:
            event: One of :class:`DownloadEvent`
            listener: Callback receiving the artifact

        Returns:
            The wrapper that was registered
        """

        def wrapper(artifact: DownloadArtifact) -> None:
            self.off(event, wrapper)
            listener(artifact)

        return self.on(event, wrapper)

    def off(self, event: str, listener: Callable[..., Any]) -> None:
        """Stop calling a listener.

        Args:
            event: One of :class:`DownloadEvent`
            listener: Callback registered earlier
        """
        with contextlib.suppress(ValueError, KeyError):
            self._listeners[event].remove(listener)

    def _emit(self, event: str, artifact: DownloadArtifact) -> None:
        """Hand an artifact to every listener for an event.

        A listener that raises is reported and skipped: observation must not be
        the reason a download is lost.

        Args:
            event: Event name
            artifact: Artifact to publish
        """
        for listener in list(self._listeners.get(event, [])):
            try:
                result = listener(artifact)
                if inspect.isawaitable(result):
                    self.track(result)
            except Exception as error:  # A listener cannot break the lifecycle.
                self._warn(f"download listener for {event} failed: {error}")

    # ==================== Sink used by the sources ====================

    def track(self, awaitable: Any) -> asyncio.Future:
        """Register in-flight work so ``idle()`` waits for it.

        Engine events are fire-and-forget, so saving is registered as work:
        otherwise ``dispose()`` could return while bytes are still being
        written and leave a ``.partial`` file as the only trace of a download.

        Args:
            awaitable: Coroutine or future to track

        Returns:
            The tracked future
        """
        task = asyncio.ensure_future(awaitable)
        self._in_flight.add(task)
        task.add_done_callback(self._in_flight.discard)
        return task

    def started(
        self,
        *,
        engine_handle: Any,
        url: str | None = None,
        suggested_filename: str | None = None,
        mime_type: str | None = None,
        page: Any = None,
    ) -> DownloadArtifact:
        """Record a download the engine has just announced.

        Args:
            engine_handle: The engine's own identity for this download
            url: Source URL
            suggested_filename: Name the page suggested
            mime_type: MIME type declared by the server
            page: Page that started the download, when the engine reports one

        Returns:
            The artifact record for this download
        """
        del page
        # One engine download can be announced twice - a context listener and a
        # page listener see the same object - so the engine's own handle is the
        # identity, not the order events arrived in.
        key = self._key(engine_handle)
        existing = self._pending.get(key)
        if existing is not None:
            return existing

        artifact = DownloadArtifact(
            id=f"dl-{next(_download_ids):06d}",
            url=url,
            suggested_filename=suggested_filename,
            state=DownloadEvent.STARTED,
            started_at=_now(),
            mime_type=mime_type,
        )
        self._pending[key] = artifact
        self._artifacts.append(artifact)
        self._emit(DownloadEvent.STARTED, artifact)
        self._claim(artifact)
        return artifact

    async def finished(
        self, artifact: DownloadArtifact | None, source: DownloadSource
    ) -> None:
        """Place a finished download's bytes under their final name.

        Args:
            artifact: Artifact record
            source: Where the engine left the bytes
        """
        if artifact is None or artifact.state != DownloadEvent.STARTED:
            return

        try:
            saved = await save_download(
                root=self.directory,
                source=source,
                suggested_filename=artifact.suggested_filename or "",
                mime_type=artifact.mime_type,
                conflict=artifact.conflict or self.conflict,
                filename=artifact.filename or self._filename,
                validate=artifact.validate or self._validate,
            )
            artifact.path = saved.path
            artifact.bytes = saved.bytes
            artifact.checksum = saved.checksum
            artifact.completed_at = _now()
            self._publish(artifact, DownloadEvent.COMPLETED)
        except Exception as error:  # Reported, never raised at the engine.
            artifact.failure = str(error)
            self._publish(artifact, DownloadEvent.FAILED)
            self._warn(f"download {artifact.id} could not be saved")
        finally:
            if source.remove_source and source.path:
                Path(source.path).unlink(missing_ok=True)

    def failed(self, artifact: DownloadArtifact | None, kind: str, reason: str) -> None:
        """Record a download that ended without a file.

        Args:
            artifact: Artifact record
            kind: One of :class:`DownloadFailure`
            reason: Engine-reported reason, kept verbatim
        """
        if artifact is None:
            return
        artifact.failure = reason
        self._publish(
            artifact,
            DownloadEvent.CANCELLED
            if kind == DownloadFailure.CANCELLED
            else DownloadEvent.FAILED,
        )

    @staticmethod
    def _key(engine_handle: Any) -> Any:
        """Build a dictionary key for an engine's download handle.

        Args:
            engine_handle: The engine's own identity for a download

        Returns:
            A hashable key
        """
        try:
            hash(engine_handle)
        except TypeError:
            return id(engine_handle)
        return engine_handle

    def _publish(self, artifact: DownloadArtifact, event: str) -> None:
        """Publish an artifact under its lifecycle event exactly once.

        Args:
            artifact: Artifact to publish
            event: Lifecycle event name
        """
        # A download reaches its end once. Both a global listener and an
        # awaited ``capture()`` read from this same record, so publishing twice
        # would mean one file reported as two.
        if artifact.id in self._published:
            return
        self._published.add(artifact.id)
        artifact.state = event
        self._emit(event, artifact)
        self._settle_waiters(artifact)

    def _settle_waiters(self, artifact: DownloadArtifact) -> None:
        """Hand a settled artifact to every waiter armed before it started.

        Args:
            artifact: Settled artifact
        """
        index = self._artifacts.index(artifact)
        for waiter in list(self._waiters):
            if index >= waiter.armed_at and not waiter.future.done():
                self._waiters.remove(waiter)
                waiter.future.set_result(artifact)

    def _claim(self, artifact: DownloadArtifact) -> None:
        """Attach the naming and validation rules of the waiting capture.

        Per-download rules are attached as the download starts, so a capture
        cannot name a download that started before it was armed.

        Args:
            artifact: Artifact that just started
        """
        index = len(self._artifacts) - 1
        for waiter in self._waiters:
            if index >= waiter.armed_at:
                claim = getattr(waiter, "claim", None)
                if claim:
                    claim(artifact)
                return

    # ==================== Waiting ====================

    async def idle(self) -> None:
        """Wait until every download the manager has seen has been placed."""
        while True:
            # Tasks that have already finished are dropped here rather than
            # awaited: ``gather`` over none-but-finished tasks returns without
            # yielding to the loop, so the callbacks that would remove them
            # never get to run and the loop below would never end.
            pending = {task for task in self._in_flight if not task.done()}
            self._in_flight.intersection_update(pending)
            if not pending:
                return
            await asyncio.gather(*pending, return_exceptions=True)

    async def capture(
        self,
        *,
        action: Callable[[], Any] | None = None,
        filename: Callable[..., Any] | str | None = None,
        timeout: float = DEFAULT_CAPTURE_TIMEOUT,
        validate: Callable[..., Any] | None = None,
        conflict: str | None = None,
    ) -> DownloadArtifact:
        """Wait for a download, optionally triggering it first.

        Args:
            action: Action that triggers the download
            filename: Name, or naming callback, for this download
            timeout: Budget for the whole capture, in milliseconds
            validate: Validation for this download
            conflict: Conflict policy for this download

        Returns:
            The settled artifact

        Raises:
            TimeoutError: When no download settled inside the budget
            RuntimeError: When the download failed or was cancelled
        """
        deadline = Deadline(timeout)
        waiter = _Waiter(
            armed_at=len(self._artifacts),
            future=asyncio.get_running_loop().create_future(),
        )

        def claim(artifact: DownloadArtifact) -> None:
            if filename is not None:
                artifact.filename = (
                    filename if callable(filename) else (lambda **_kwargs: filename)
                )
            if validate is not None:
                artifact.validate = validate
            if conflict is not None:
                artifact.conflict = conflict

        waiter.claim = claim  # type: ignore[attr-defined]
        self._waiters.append(waiter)

        # Both the waiter and the naming rules are armed before the action
        # runs. A download can start, finish and be saved inside ``action()`` -
        # attaching them afterwards would save the file under the wrong name
        # and skip the caller's validation entirely.
        try:
            if action is not None:
                result = action()
                if inspect.isawaitable(result):
                    await result
        except BaseException:
            self._discard(waiter)
            raise

        try:
            artifact = await asyncio.wait_for(
                asyncio.shield(waiter.future),
                timeout=max(0.001, deadline.remaining_ms() / 1000),
            )
        except asyncio.TimeoutError as error:
            self._discard(waiter)
            msg = f"no download completed within {timeout}ms of the triggering action"
            raise TimeoutError(msg) from error
        finally:
            self._discard(waiter)

        if artifact.state != DownloadEvent.COMPLETED:
            msg = f"download {artifact.id} {artifact.state}: {artifact.failure}"
            raise RuntimeError(msg)
        return artifact

    def _discard(self, waiter: _Waiter) -> None:
        """Forget a waiter that is no longer waiting.

        Args:
            waiter: The waiter to remove
        """
        if waiter in self._waiters:
            self._waiters.remove(waiter)

    # ==================== Attachment ====================

    async def attach(
        self,
        *,
        engine: str = "playwright",
        browser: Any = None,
        context: Any = None,
        page: Any = None,
        poll_interval: float | None = None,
    ) -> None:
        """Attach the one download source this engine and browser can offer.

        Args:
            engine: ``playwright`` or ``selenium``
            browser: Browser or persistent context
            context: Playwright browser context, when it is not the browser
            page: A page belonging to the browser
            poll_interval: Seconds between directory listings, for engines
                without download events
        """
        if engine != "playwright":
            # Selenium has no download events at all, so the staging directory
            # is the only evidence a download happened - including one a person
            # started, which no automated event would ever report.
            self._sources.append(
                await attach_filesystem_watcher(
                    root=self.directory,
                    sink=self,
                    driver=browser if browser is not None else page,
                    interval=(
                        DEFAULT_POLL_INTERVAL
                        if poll_interval is None
                        else poll_interval
                    ),
                )
            )
            return

        await self._attach_cdp(browser=browser, page=page)

        # Without Browser-domain access - an attached browser that refuses it,
        # or a context with no page to borrow a session from - Playwright's own
        # event still covers every automated download.
        observed = (
            context
            if context is not None
            else download_context(browser=browser, page=page)
        )
        if not self._sources and getattr(observed, "on", None) is not None:
            self._sources.append(attach_playwright_source(context=observed, sink=self))

        if not self._sources:
            self._warn(
                "no download source could be attached: downloads will not be managed"
            )

    async def _attach_cdp(self, *, browser: Any, page: Any) -> None:
        """Attach the CDP source, when the browser grants Browser-domain access.

        CDP is what makes a download a *person* started observable, so it is
        tried first. It is also exclusive: ``Browser.setDownloadBehavior``
        takes the bytes away from Playwright's own download handling, so
        attaching both sources would mean one download reported twice and a
        Playwright ``path()`` pointing at a file that was never written.

        Args:
            browser: Browser or persistent context
            page: A page belonging to the browser
        """
        try:
            session = await open_browser_cdp_session(
                engine="playwright", browser=browser, page=page
            )
            if session is None:
                return
            self._cdp_session = session
            self._sources.append(
                await attach_cdp_source(
                    session=session,
                    root=self.directory,
                    sink=self,
                    staging_timeout=self._staging_timeout,
                    staging_poll_interval=self._staging_poll_interval,
                )
            )
        except Exception as error:  # Reported, never fatal.
            self._cdp_session = None
            self._warn(f"manual downloads are not observable: {error}")

    def _warn(self, message: str) -> None:
        """Report something the caller may want to know about.

        Args:
            message: What could not be done
        """
        warn = getattr(self._log, "warn", None)
        if warn:
            warn(message)

    # ==================== Lifecycle ====================

    async def dispose(self) -> None:
        """Stop observing downloads.

        Saved files are untouched: persistence is the point of the manager, so
        detaching must never be the thing that removes a user's file.
        """
        # A download still being written is finished first: detaching must not
        # be the reason a file only ever exists under its ``.partial`` name.
        await self.idle()
        for handle in self._sources:
            result = handle.detach()
            if inspect.isawaitable(result):
                await result
        await self.idle()
        if self._cdp_session is not None:
            detach = getattr(self._cdp_session, "detach", None)
            if detach:
                with contextlib.suppress(Exception):
                    result = detach()
                    if inspect.isawaitable(result):
                        await result
        self._listeners.clear()


async def create_download_manager(
    *,
    engine: str = "playwright",
    browser: Any = None,
    context: Any = None,
    page: Any = None,
    directory: str | None = None,
    persist: bool = True,
    conflict: str = DownloadConflict.RENAME,
    filename: Callable[..., Any] | None = None,
    validate: Callable[..., Any] | None = None,
    log: Any = None,
    poll_interval: float | None = None,
    staging_timeout: float = DEFAULT_STAGING_TIMEOUT,
    staging_poll_interval: float = DEFAULT_STAGING_POLL_INTERVAL,
) -> DownloadManager:
    """Create the download manager for a browser.

    Args:
        engine: ``playwright`` or ``selenium``
        browser: Browser or persistent context
        context: Playwright browser context, when it is not the browser handle
        page: A page belonging to the browser
        directory: Absolute path, ``user-downloads`` or ``temporary``
        persist: Keep files after the browser closes
        conflict: ``rename``, ``overwrite`` or ``error``
        filename: Naming callback for every download
        validate: Validation for every download
        log: Logger
        poll_interval: Seconds between directory listings, for engines without
            download events
        staging_timeout: Seconds a completed download has to become readable on
            disk before it is reported as failed (issue #92)
        staging_poll_interval: Seconds between readings of the staged file

    Returns:
        A manager already attached to the browser
    """
    # Resolved and probed before a single download can start: a permission
    # problem found afterwards looks like a file that never arrived.
    root = prepare_download_directory(resolve_download_directory(directory))

    manager = DownloadManager(
        directory=root,
        persist=persist,
        conflict=conflict,
        filename=filename,
        validate=validate,
        log=log,
        staging_timeout=staging_timeout,
        staging_poll_interval=staging_poll_interval,
    )

    await manager.attach(
        engine=engine,
        browser=browser,
        context=context,
        page=page,
        poll_interval=poll_interval,
    )
    return manager


def download_context(*, browser: Any = None, page: Any = None) -> Any:
    """Find the object Playwright emits its ``download`` event on.

    A download is a *context*-level event. ``launch_browser()`` hands back a
    persistent context, so the browser handle works there by accident; a
    ``Browser`` returned by ``connect_browser()`` never emits ``download`` at
    all. Taking the page's context is what makes an attached browser behave
    exactly like a launched one.

    Args:
        browser: Browser or persistent context
        page: A page belonging to the browser

    Returns:
        The context downloads are observed on
    """
    return getattr(page, "context", None) or browser
