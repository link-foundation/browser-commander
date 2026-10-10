"""Trigger and overlay regressions with bounded asynchronous waits."""

import asyncio
from types import SimpleNamespace

import pytest

from browser_commander.core.commander_features import dismiss_overlays
from browser_commander.core.page_trigger_manager import PageTriggerManager


def manager():
    nav = SimpleNamespace(
        _get_current_url=lambda: "https://example.test/new", off=lambda *_args: None
    )
    return PageTriggerManager(nav, SimpleNamespace(debug=lambda *_args: None))


@pytest.mark.parametrize("concurrency", ["skip", "queue"])
async def test_dom_ready_survives_stopping(concurrency):
    triggers = manager()
    started, release, completed = asyncio.Event(), asyncio.Event(), asyncio.Event()
    calls = []

    async def action(ctx):
        calls.append(ctx.url)
        if len(calls) == 1:
            started.set()
            await release.wait()
        else:
            completed.set()

    triggers.page_trigger(
        {
            "condition": lambda _url: True,
            "action": action,
            "ready_on": "domcontentloaded",
            "concurrency": concurrency,
        }
    )
    try:
        await triggers._check_triggers("https://example.test/new", "domcontentloaded")
        await asyncio.wait_for(started.wait(), timeout=2)
        triggers._on_url_change({"new_url": "https://example.test/new"})
        await triggers._check_triggers("https://example.test/new", "domcontentloaded")
        assert len(calls) == 1
        release.set()
        await asyncio.wait_for(completed.wait(), timeout=2)
        assert len(calls) == 2
    finally:
        await triggers.destroy()


async def test_restart_before_task_enters_still_runs_replacement():
    triggers = manager()
    completed = asyncio.Event()

    async def action(ctx):
        completed.set()

    triggers.page_trigger(
        {"condition": lambda _url: True, "action": action, "concurrency": "restart"}
    )
    try:
        await triggers._check_triggers("https://example.test/new")
        await triggers._check_triggers("https://example.test/new")
        await asyncio.wait_for(completed.wait(), timeout=2)
        assert not triggers._pending
    finally:
        await triggers.destroy()


@pytest.mark.parametrize("fail_click", [False, True])
async def test_overlay_uses_visible_match_and_reports_failed_click(fail_click):
    calls, reported = [], []

    class Locator:
        def __init__(self, index):
            self.index = index

        async def is_visible(self):
            return self.index == 1

        async def click(self, **kwargs):
            calls.append(self.index)
            if fail_click:
                raise RuntimeError("dismissal failed")

    class Matches:
        async def count(self):
            return 2

        def nth(self, index):
            return Locator(index)

    commander = SimpleNamespace(
        engine="playwright", page=SimpleNamespace(locator=lambda _selector: Matches())
    )

    def report(value):
        reported.append(value)
        raise RuntimeError("report failed")

    outcomes = await dismiss_overlays(commander, [".overlay"], report)
    assert calls == [1]
    assert outcomes == ([] if fail_click else [".overlay"])
    assert reported[0]["status"] == ("error" if fail_click else "dismissed")
    if fail_click:
        assert "dismissal failed" in str(reported[0]["error"])


async def test_overlay_visibility_wait_is_bounded():
    class Matches:
        async def count(self):
            await asyncio.Event().wait()

    commander = SimpleNamespace(
        engine="playwright", page=SimpleNamespace(locator=lambda _selector: Matches())
    )
    reported = []
    outcomes = await asyncio.wait_for(
        dismiss_overlays(
            commander, [{"selector": ".overlay", "timeout": 20}], reported.append
        ),
        timeout=1,
    )
    assert outcomes == []
    assert reported[0]["status"] == "error"
