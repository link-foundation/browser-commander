"""Attaching the download manager to a browser (issue #88).

Every entry point - ``launch_browser()``, ``connect_browser()``,
``launch_real_browser()`` and ``commander.configure_downloads()`` - goes
through this one function, so the managed lifecycle is the same however the
browser was obtained. The manager is built from the browser and page, never
from the way they were created.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from browser_commander.downloads.manager import (
    DownloadManager,
    create_download_manager,
)


def normalize_download_options(
    downloads: bool | Mapping[str, Any] | None,
) -> dict[str, Any] | None:
    """Normalize the ``downloads`` option into manager options.

    Args:
        downloads: ``True`` for defaults, or an options mapping

    Returns:
        Manager options, or ``None`` when downloads are not managed

    Raises:
        TypeError: When the option is neither a flag nor a mapping
    """
    if downloads is None or downloads is False:
        return None
    if downloads is True:
        return {}
    if not isinstance(downloads, Mapping):
        msg = "downloads must be True, False or a mapping of options"
        raise TypeError(msg)
    return dict(downloads)


async def attach_downloads(
    *,
    engine: str,
    browser: Any = None,
    page: Any = None,
    downloads: bool | Mapping[str, Any] | None = None,
    log: Any = None,
) -> DownloadManager | None:
    """Build the download manager for a browser, if the caller asked for one.

    Args:
        engine: ``playwright`` or ``selenium``
        browser: Browser or persistent context
        page: A page belonging to the browser
        downloads: The caller's ``downloads`` option
        log: Logger

    Returns:
        A download manager, or ``None`` when downloads were not requested
    """
    manager_options = normalize_download_options(downloads)
    if manager_options is None:
        return None

    return await create_download_manager(
        engine=engine,
        browser=browser,
        page=page,
        log=log,
        **manager_options,
    )
