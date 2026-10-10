"""Opt-in debug traces and known overlays, sharing the commander lifecycle."""

import asyncio
import inspect
import os
from functools import wraps

INTERACTIONS = {"click_button", "click_element", "fill_text_area", "check", "press_key"}


async def dismiss_overlays(commander, overlays, on_dismiss=None):
    reports = []
    for entry in overlays or []:
        options = {"selector": entry} if isinstance(entry, str) else entry
        selector = options["selector"]
        report = {"selector": selector, "status": "absent"}
        timeout = float(options.get("timeout", 1000) or 1000) / 1000

        async def dismiss(selector=selector, options=options, report=report):
            if commander.engine == "playwright":
                matches = commander.page.locator(selector)
                for index in range(await matches.count()):
                    locator = matches.nth(index)
                    if await locator.is_visible():
                        await locator.click(timeout=options.get("timeout", 1000))
                        report["status"] = "dismissed"
                        break
            else:
                from browser_commander.core.engine_adapter import create_engine_adapter

                adapter = create_engine_adapter(commander.page, commander.engine)
                for element in await adapter.query_selector_all(selector):
                    if element.is_displayed():
                        await adapter.click(element)
                        report["status"] = "dismissed"
                        break

        try:
            await asyncio.wait_for(dismiss(), timeout=timeout)
        except Exception as error:
            report.update(status="error", error=error)
        reports.append(report)
        for callback in (options.get("on_dismiss"), on_dismiss):
            if callable(callback):
                try:
                    value = callback(report)
                    if inspect.isawaitable(value):
                        await asyncio.wait_for(value, timeout=timeout)
                except Exception:
                    pass
    return [report["selector"] for report in reports if report["status"] == "dismissed"]


def attach_commander_features(commander, options):
    output = (
        (options.get("debug") or {}).get("output")
        if isinstance(options.get("debug"), dict)
        else options.get("output")
    )
    output = output or os.environ.get("BROWSER_COMMANDER_TRACE")
    trace = None
    managed = set()
    original_start = commander.start_trace

    async def start(**trace_options):
        item = await original_start(**trace_options)
        stop = item.stop

        async def finish(**stop_options):
            try:
                return await stop(**stop_options)
            finally:
                managed.discard(item)

        item.stop = finish
        managed.add(item)
        return item

    commander.start_trace = start

    async def ensure_debug():
        nonlocal trace
        if output and (
            options.get("debug") or os.environ.get("BROWSER_COMMANDER_TRACE")
        ):
            if trace is None:
                trace = asyncio.create_task(
                    start(
                        output=output,
                        mode="continuous",
                        checkpoint_on_navigation=True,
                        network={"har": True},
                        links={"output": str(output) + ".links", "dom": "text"},
                    )
                )
            await trace

    def wrap(name, method):
        @wraps(method)
        async def action(*args, **kwargs):
            session = options.get("session")
            if session:
                await session.touch()
            await ensure_debug()
            if name in INTERACTIONS:
                await dismiss_overlays(
                    commander,
                    options.get("overlays"),
                    options.get("on_overlay_dismiss"),
                )
            return await method(*args, **kwargs)

        return action

    for name in INTERACTIONS | {"goto", "evaluate", "count"}:
        if hasattr(commander, name):
            setattr(commander, name, wrap(name, getattr(commander, name)))
    destroy = commander.destroy

    async def finish():
        try:
            if trace:
                await trace
            await asyncio.gather(*(item.stop() for item in list(managed)))
        finally:
            await destroy()

    commander.destroy = finish
    commander.dismiss_overlays = lambda overlays=None: dismiss_overlays(
        commander,
        overlays or options.get("overlays"),
        options.get("on_overlay_dismiss"),
    )

    async def reuse_page(**selection):
        if not options.get("session"):
            raise ValueError("reuse_page requires a persistent session")
        selected = await options["session"].reuse_page(**selection)
        if selected is not commander.page:
            await commander.destroy()
            commander.__init__(selected, **commander._initial_options)
        return selected

    commander.reuse_page = reuse_page
    if output and (options.get("debug") or os.environ.get("BROWSER_COMMANDER_TRACE")):
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            pass
        else:
            commander.ready = asyncio.create_task(ensure_debug())
