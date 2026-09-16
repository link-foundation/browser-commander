"""Engine-specific download event sources (issue #88).

Each source turns one engine's download notifications into the same three
calls - ``started``, ``finished``, ``failed`` - so the manager above them does
not know or care whether the bytes came from Playwright or from CDP, and a
download a human started by hand is reported exactly like an automated one.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from browser_commander.downloads.destination import ARTIFACT_DIRECTORY_MODE
from browser_commander.downloads.store import DownloadSource


class DownloadFailure:
    """Why a download ended without a file."""

    #: The browser or the person stopped it.
    CANCELLED = "cancelled"
    #: It ended in an error.
    FAILED = "failed"


#: Directory the engine writes into before we place the file.
STAGING_DIRECTORY = ".browser-commander-staging"

_CANCELLED = re.compile(r"cancel", re.IGNORECASE)


def classify_failure(reason: object) -> str:
    """Classify an engine's failure text.

    "A download UI entry is not completion evidence" (issue #88): the engine's
    own words are the only thing that distinguishes a user cancelling a
    download from a network error, so they are preserved and classified, not
    flattened.

    Args:
        reason: Engine-reported reason

    Returns:
        One of :class:`DownloadFailure`
    """
    return (
        DownloadFailure.CANCELLED
        if _CANCELLED.search(str(reason or ""))
        else DownloadFailure.FAILED
    )


class SourceHandle:
    """One attached source, with the detach its engine needs."""

    def __init__(
        self,
        detach: Any,
        staging_directory: str | None = None,
        watcher: Any = None,
    ) -> None:
        """Store the detach callback.

        Args:
            detach: Callable that stops the source, sync or async
            staging_directory: Directory the engine stages bytes in, if any
            watcher: The directory watcher, when this source polls for files
        """
        self.detach = detach
        self.staging_directory = staging_directory
        self.watcher = watcher


def attach_playwright_source(*, context: Any, sink: Any) -> SourceHandle:
    """Attach to Playwright's context-level download event.

    Args:
        context: Playwright browser context
        sink: Object with ``started``/``finished``/``failed``/``track``

    Returns:
        A handle that can detach the listener
    """

    async def handle(download: Any) -> None:
        page = getattr(download, "page", None)
        record = sink.started(
            engine_handle=download,
            url=download.url,
            suggested_filename=download.suggested_filename,
            page=page,
        )

        try:
            failure = await download.failure()
            if failure:
                sink.failed(record, classify_failure(failure), str(failure))
                return

            # ``path()`` resolves only once the bytes are on disk, which is the
            # engine's own evidence that the download completed.
            engine_path = await download.path()
            await sink.finished(record, DownloadSource(path=str(engine_path)))
        except Exception as error:  # The engine's words are the evidence.
            sink.failed(record, classify_failure(error), str(error))

    def on_download(download: Any) -> None:
        sink.track(handle(download))

    context.on("download", on_download)

    def detach() -> None:
        remove = getattr(context, "remove_listener", None)
        if remove is not None:
            remove("download", on_download)

    return SourceHandle(detach=detach)


async def attach_cdp_source(*, session: Any, root: str, sink: Any) -> SourceHandle:
    """Point Chromium at a staging directory and report every download it starts.

    This is the only source that sees a download a *person* started, because
    ``Browser.setDownloadBehavior`` is browser-wide rather than per-automation.

    Args:
        session: CDP session with Browser domain access
        root: Managed download directory
        sink: Object with ``started``/``finished``/``failed``/``track``

    Returns:
        A handle that can detach the listeners
    """
    staging_directory = str(Path(root, STAGING_DIRECTORY))
    Path(staging_directory).mkdir(
        parents=True, exist_ok=True, mode=ARTIFACT_DIRECTORY_MODE
    )

    # ``allowAndName`` writes each file under its GUID, so two downloads that
    # suggest the same name cannot overwrite each other before we have placed
    # them, and the GUID is the identity we deduplicate on.
    await session.send(
        "Browser.setDownloadBehavior",
        {
            "behavior": "allowAndName",
            "downloadPath": staging_directory,
            "eventsEnabled": True,
        },
    )

    by_guid: dict[str, Any] = {}

    def on_will_begin(event: dict[str, Any]) -> None:
        by_guid[event["guid"]] = sink.started(
            engine_handle=event["guid"],
            url=event.get("url"),
            suggested_filename=event.get("suggestedFilename"),
        )

    def on_progress(event: dict[str, Any]) -> None:
        record = by_guid.get(event["guid"])
        state = event.get("state")
        if record is None or state == "inProgress":
            return

        del by_guid[event["guid"]]
        if state == "completed":
            sink.track(
                sink.finished(
                    record,
                    DownloadSource(
                        path=str(Path(staging_directory, event["guid"])),
                        remove_source=True,
                    ),
                )
            )
            return
        sink.failed(
            record,
            DownloadFailure.CANCELLED,
            f"download {state} by the browser",
        )

    session.on("Browser.downloadWillBegin", on_will_begin)
    session.on("Browser.downloadProgress", on_progress)

    def detach() -> None:
        remove = getattr(session, "remove_listener", None)
        if remove is not None:
            remove("Browser.downloadWillBegin", on_will_begin)
            remove("Browser.downloadProgress", on_progress)

    return SourceHandle(detach=detach, staging_directory=staging_directory)


async def open_browser_cdp_session(
    *,
    engine: str,
    browser: Any = None,
    page: Any = None,
) -> Any:
    """Open a CDP session that can drive the Browser domain.

    A page-scoped session only hears about the downloads that page started, so
    a browser-wide session is what makes a download a *person* began - in a tab
    the automation never opened - observable at all.

    Args:
        engine: Engine name
        browser: Browser or persistent context
        page: Page to borrow a session from

    Returns:
        A CDP session, or ``None`` when the engine cannot open one
    """
    if engine != "playwright":
        # Selenium's CDP bridge is request/response only: it can send
        # ``Browser.setDownloadBehavior`` but has no event stream to listen on,
        # so it is served by the filesystem watcher instead.
        return None

    handle = getattr(browser, "browser", None) or browser
    open_browser_session = getattr(handle, "new_browser_cdp_session", None)
    if open_browser_session is not None:
        return await open_browser_session()

    context = getattr(page, "context", None) or browser
    open_page_session = getattr(context, "new_cdp_session", None)
    if page is not None and open_page_session is not None:
        return await open_page_session(page)
    return None
