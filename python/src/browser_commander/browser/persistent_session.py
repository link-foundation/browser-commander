"""Owned persistent CDP sessions, sharing the npm package's detached watchdog."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
from dataclasses import asdict
from typing import Any

from browser_commander.browser.connector import (
    ConnectOptions,
    connect_browser,
    pick_foreground_page,
)
from browser_commander.browser.launcher import LaunchOptions
from browser_commander.capture import UnsupportedCaptureError
from browser_commander.utilities.subprocess import run_command


async def _worker(options: dict[str, Any]) -> dict[str, Any]:
    from browser_commander.cli import js_cli_path

    worker = js_cli_path().parent.parent / "src/browser/session-worker.js"
    result = await run_command(
        os.environ.get("BROWSER_COMMANDER_NODE", "node"),
        [str(worker)],
        input=json.dumps(options, default=str),
    )
    return json.loads(result.stdout)


class PersistentSession:
    """detach keeps Chrome running; close terminates only this owned session."""

    def __init__(self, connection, metadata, *, close_new_tabs=False):
        self.browser, self.page = connection.browser, connection.page
        self.downloads = connection.downloads
        self.metadata = metadata
        self.user_data_dir = metadata["userDataDir"]
        self.remote_debugging_port = metadata["remoteDebuggingPort"]
        self.cdp_endpoint = metadata["cdpEndpoint"]
        self.reused = metadata["reused"]
        self.temporary_profile = False
        self._detached = False
        self._closed = False
        self._tab_tasks: set[asyncio.Task] = set()
        self._context = self.page.context
        self._close_new_tabs = close_new_tabs
        self._selecting = False
        if close_new_tabs:
            self._context.on("page", self._on_new_page)
        self._heartbeat = asyncio.create_task(self._keep_alive())

    async def _keep_alive(self):
        interval = max(
            0.02, min(30, self.metadata.get("idleTimeoutMs", 1800000) / 3000)
        )
        while True:
            await asyncio.sleep(interval)
            with contextlib.suppress(Exception):
                await self.touch()

    def _on_new_page(self, page):
        async def close():
            if page is not self.page and not self._detached and not self._selecting:
                with contextlib.suppress(Exception):
                    await page.close()

        task = asyncio.create_task(close())
        self._tab_tasks.add(task)
        task.add_done_callback(self._tab_tasks.discard)

    async def touch(self, target_id=None):
        await _worker({**self.metadata, "operation": "touch", "targetId": target_id})

    async def detach(self):
        if self._detached:
            return
        self._heartbeat.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._heartbeat
        if self._close_new_tabs:
            self._context.remove_listener("page", self._on_new_page)
        await asyncio.gather(*self._tab_tasks, return_exceptions=True)
        try:
            await self.touch()
            if self.downloads:
                await self.downloads.dispose()
        finally:
            await self.browser.close()
            self._detached = True

    async def close(self):
        if self._closed:
            return
        if not self._detached:
            await self.detach()
        await _worker({**self.metadata, "operation": "close"})
        self._closed = True

    async def reuse_page(
        self, *, target_id=None, url=None, url_matchers=None, single_tab=False
    ):
        if self._detached:
            raise RuntimeError("Persistent controller is detached")
        self._selecting = True
        try:
            self.page = (
                await pick_foreground_page(
                    self._context.pages,
                    ConnectOptions(
                        target_id=target_id
                        or (None if url or url_matchers else self.metadata["targetId"]),
                        url=url,
                        url_matchers=url_matchers or [],
                        fallback=target_id is None,
                        single_tab=single_tab,
                    ),
                )
                or await self._context.new_page()
            )
        finally:
            self._selecting = False
            if self._close_new_tabs:
                await asyncio.gather(
                    *(
                        page.close()
                        for page in self._context.pages
                        if page is not self.page
                    ),
                    return_exceptions=True,
                )
        session = await self.page.context.new_cdp_session(self.page)
        try:
            target = (await session.send("Target.getTargetInfo"))["targetInfo"][
                "targetId"
            ]
        finally:
            await session.detach()
        self.metadata["targetId"] = target
        await self.touch(target)
        return self.page


async def connect_or_launch(
    options: LaunchOptions | None = None, **settings
) -> PersistentSession:
    options = options or LaunchOptions(**settings)
    if options.engine != "playwright":
        raise UnsupportedCaptureError("persistent CDP session", options.engine)

    def camel(key):
        first, *rest = key.split("_")
        return first + "".join(item.title() for item in rest)

    payload = {
        camel(key): value for key, value in asdict(options).items() if value is not None
    }
    payload.pop("diagnosticRedactor", None)
    payload.pop("persistSessionCookies", None)
    metadata = await _worker(payload)
    connection = await connect_browser(
        ConnectOptions(
            cdp_endpoint=metadata["cdpEndpoint"],
            target_id=metadata["targetId"],
            fallback=True,
            no_defaults=options.no_defaults,
            downloads=options.downloads,
        )
    )
    return PersistentSession(
        connection, metadata, close_new_tabs=options.close_new_tabs
    )
