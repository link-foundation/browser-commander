"""Record a portable trace from a real Playwright Chromium (issue #108).

A trace claims to hold the state a run was actually in: the value typed rather
than the one the page was served with, the DOM changes made between two
checkpoints, and every navigation, interaction and dialog in one order. None
of that can be proven against a fake page, so this drives a real browser and
finishes by opening the offline viewer in it.

Run with ``RUN_E2E=true CHROME_NO_SANDBOX=true pytest
tests/e2e/test_trace_recording.py -m e2e``.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any

import pytest

from browser_commander import make_browser_commander
from browser_commander.traces import (
    TraceEvent,
    TraceFiles,
    TraceMode,
    TraceOutcome,
    read_trace,
    trace_links,
    write_trace_links,
    write_trace_viewer,
)
from browser_commander.traces.links import format_trace_links

pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(
        os.environ.get("RUN_E2E", "").lower() not in {"1", "true", "yes"},
        reason="set RUN_E2E=true to record traces from a real browser",
    ),
]

#: Assembled rather than written out, so a secret scanner does not mistake
#: the fixture for a leak.
SECRET = "-".join(["hunter2", "never", "persisted"])
TYPED = "typed in the browser"

FIRST_PAGE = """<!doctype html>
<html><head><title>first</title></head>
<body><h1>first page</h1></body></html>"""

APP_PAGE = """<!doctype html>
<html><head><title>app</title></head>
<body>
  <form>
    <input id="name" value="sent by the server">
    <input id="password" type="password">
    <textarea id="note"></textarea>
  </form>
  <ul id="list"></ul>
  <button id="add" type="button"
    onclick="const li = document.createElement('li');
             li.textContent = 'item ' + document.querySelectorAll('li').length;
             document.getElementById('list').appendChild(li);">add</button>
  <button id="touch" type="button"
    onclick="document.getElementById('list').setAttribute('data-touched', 'yes')">
    touch</button>
</body></html>"""


async def wait_for_events(path: str, kinds: set[str]) -> list[dict[str, Any]]:
    """Wait until the timeline holds every kind of event named."""
    deadline = time.monotonic() + 20
    while True:
        events = read_trace(path).events
        seen = {event["kind"] for event in events}
        if kinds <= seen:
            return events
        if time.monotonic() > deadline:
            raise AssertionError(f"timed out waiting for {kinds}; saw {seen}")
        await asyncio.sleep(0.1)


def bundle_text(path: str) -> str:
    """Everything the bundle holds, as one string to search."""
    return "\n".join(
        file.read_text(encoding="utf-8", errors="replace")
        for file in sorted(Path(path).rglob("*"))
        if file.is_file()
    )


async def test_records_a_real_run_and_explains_it_offline(tmp_path: Path) -> None:
    from playwright.async_api import async_playwright

    args = ["--no-sandbox"] if os.environ.get("CHROME_NO_SANDBOX") == "true" else []
    first = tmp_path / "first.html"
    first.write_text(FIRST_PAGE, encoding="utf-8")
    bundle = tmp_path / "bundle"
    streamed = tmp_path / "streamed.lino"

    async with async_playwright() as playwright:
        # CI points CHROME_PATH at the runner's Chrome rather than downloading
        # a Playwright Chromium; locally the bundled one is used.
        browser = await playwright.chromium.launch(
            headless=True,
            args=args,
            executable_path=os.environ.get("CHROME_PATH") or None,
        )
        try:
            page = await browser.new_page()
            commander = make_browser_commander(page, enable_network_tracking=False)
            try:
                trace = await commander.start_trace(
                    output=str(bundle),
                    mode=TraceMode.CONTINUOUS,
                    screenshots=False,
                    links={"output": str(streamed)},
                )

                await commander.goto(first.as_uri())
                await page.set_content(APP_PAGE)
                await trace.checkpoint("loaded")

                await page.focus("#note")
                await commander.keyboard_type(TYPED)
                await commander.keyboard_press("Tab")
                await page.fill("#password", SECRET)
                await page.click("#add")
                await page.click("#add")
                await page.click("#touch")
                await page.evaluate("setTimeout(() => alert('are you sure?'), 0)")
                await wait_for_events(trace.path, {TraceEvent.DIALOG})
                await trace.checkpoint("the app updated itself")

                stopped = await trace.stop()
            finally:
                await commander.destroy()

            assert stopped["manifest"]["outcome"] == TraceOutcome.COMPLETE
            assert stopped["problems"] == []
            recorded = read_trace(stopped["path"])
            kinds = [event["kind"] for event in recorded.events]
            assert kinds[0] == TraceEvent.TRACE_START
            assert kinds[-1] == TraceEvent.TRACE_STOP
            for kind in (
                TraceEvent.NAVIGATION,
                TraceEvent.INTERACTION,
                TraceEvent.CHECKPOINT,
                TraceEvent.DIALOG,
            ):
                assert kind in kinds, kind
            sequences = [event["sequence"] for event in recorded.events]
            assert sequences == sorted(sequences)

            actions = [
                event
                for event in recorded.events
                if event["kind"] == TraceEvent.INTERACTION
            ]
            assert [event["action"] for event in actions] == [
                "goto",
                "typeText",
                "pressKey",
            ]
            assert actions[0]["target"] == first.as_uri()

            dialog = next(
                event for event in recorded.events if event["kind"] == TraceEvent.DIALOG
            )
            assert dialog["message"] == "are you sure?"

            names = [checkpoint.name for checkpoint in recorded.checkpoints]
            assert names[-2:] == ["loaded", "the app updated itself"]
            last = len(recorded.checkpoints)

            # The state holds what was typed, not what the server sent.
            controls = {
                control["path"]: control for control in recorded.state(last)["controls"]
            }
            note = next(c for path, c in controls.items() if "note" in path)
            assert note["value"] == TYPED
            assert "item 1" in (recorded.html(last) or "")

            # The DOM changes made after "loaded" belong to that checkpoint.
            records = [
                record
                for batch in recorded.mutations(last - 1)
                for record in batch["records"]
            ]
            assert any(record["kind"] == "childList" for record in records)
            assert any(record["kind"] == "attributes" for record in records)

            # A password never reaches the disk, and typed text never reaches
            # the timeline.
            assert SECRET not in bundle_text(stopped["path"])
            events_text = Path(stopped["path"], TraceFiles.EVENTS).read_text(
                encoding="utf-8"
            )
            assert TYPED not in events_text

            # The export streamed while recording is the one read back after.
            (tmp_path / "exported").mkdir()
            exported = write_trace_links(stopped["path"], tmp_path / "exported")
            assert Path(exported).name == "trace.lino"
            assert streamed.read_bytes() == Path(exported).read_bytes()
            assert Path(exported).read_text(encoding="utf-8") == format_trace_links(
                trace_links(recorded)
            )
            assert SECRET not in Path(exported).read_text(encoding="utf-8")

            # The viewer opens from a file URL in the same browser.
            viewer = write_trace_viewer(stopped["path"])
            assert Path(viewer).name == TraceFiles.VIEWER
            viewer_page = await browser.new_page()
            errors: list[str] = []
            viewer_page.on("pageerror", lambda error: errors.append(str(error)))
            await viewer_page.goto(Path(viewer).as_uri())
            text = await viewer_page.locator("body").inner_text()
            assert "the app updated itself" in text
            assert errors == []
            data = json.loads(
                await viewer_page.locator("#trace-data").text_content() or "{}"
            )
            assert len(data["checkpoints"]) == last
        finally:
            await browser.close()
