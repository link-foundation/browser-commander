"""Opt-in debug traces and known overlays, sharing the commander lifecycle."""

import asyncio
import os
from functools import wraps

INTERACTIONS = {"click_button", "click_element", "fill_text_area", "check", "press_key"}


async def dismiss_overlays(commander, overlays):
    dismissed = []
    for entry in overlays or []:
        selector = entry if isinstance(entry, str) else entry["selector"]
        if commander.engine == "playwright":
            locator = commander.page.locator(selector).first
            if await locator.is_visible():
                await locator.click(timeout=1000)
                dismissed.append(selector)
        else:
            from browser_commander.core.engine_adapter import create_engine_adapter

            adapter = create_engine_adapter(commander.page, commander.engine)
            from browser_commander.elements.visibility import is_visible

            element = await adapter.query_selector(selector)
            if element is not None and await is_visible(
                page=commander.page, engine=commander.engine, selector=selector
            ):
                await adapter.click(element)
                dismissed.append(selector)
    return dismissed


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
                await dismiss_overlays(commander, options.get("overlays"))
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
        commander, overlays or options.get("overlays")
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
