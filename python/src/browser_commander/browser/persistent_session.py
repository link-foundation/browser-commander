"""Owned persistent CDP sessions, sharing the npm package's detached watchdog."""

from __future__ import annotations

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

    def __init__(self, connection, metadata):
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

    async def touch(self, target_id=None):
        await _worker({**self.metadata, "operation": "touch", "targetId": target_id})

    async def detach(self):
        if self._detached:
            return
        await self.touch()
        try:
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

    async def reuse_page(self, *, target_id=None, url=None, single_tab=False):
        if self._detached:
            raise RuntimeError("Persistent controller is detached")
        self.page = await pick_foreground_page(
            self.page.context.pages,
            ConnectOptions(
                target_id=target_id or (None if url else self.metadata["targetId"]),
                url=url,
                single_tab=single_tab,
            ),
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
            downloads=options.downloads,
        )
    )
    return PersistentSession(connection, metadata)
