"""Checkpoint and default screenshots capture the view without a clip (issue #180).

A clipped engine screenshot of a headful window can leave Chrome's emulated
size stuck after a resize. Without a fixed viewport, captures go through CDP
``Page.captureScreenshot`` with no ``clip``.
"""

from __future__ import annotations

import base64
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest

from browser_commander.capture import screenshot
from browser_commander.traces import read_trace, start_trace
from tests.helpers.trace_fakes import ActionCommander, FakePage, make_snapshot

VIEW = {"format": "png", "fromSurface": False, "captureBeyondViewport": False}


def cdp_page(
    engine: str = "playwright", viewport: Any = None, fail: str | None = None
) -> tuple[FakePage, SimpleNamespace]:
    session = SimpleNamespace(
        send=AsyncMock(
            side_effect=RuntimeError(fail) if fail else None,
            return_value={"data": base64.b64encode(b"cdp-png").decode()},
        ),
        detach=AsyncMock(),
    )
    page = FakePage(make_snapshot())
    page.screenshot_bytes = b"engine-png"
    capture = page.screenshot

    async def either_shape(*_args: Any, **options: Any) -> bytes:
        # Puppeteer's bridge takes one options dict, Playwright keywords.
        return await capture(**options)

    page.screenshot = either_shape  # type: ignore[method-assign]
    if engine == "playwright":
        page.context = SimpleNamespace(new_cdp_session=AsyncMock(return_value=session))
        page.viewport_size = viewport  # type: ignore[attr-defined]
    else:
        page.create_cdp_session = AsyncMock(return_value=session)  # type: ignore[attr-defined]
        page.viewport = AsyncMock(return_value=viewport)  # type: ignore[attr-defined]
    return page, session


async def checkpoint_shot(
    tmp_path: Path, page: FakePage, engine: str | None = "playwright"
) -> bytes:
    commander = None
    if engine is not None:
        commander = ActionCommander(page)
        commander.engine = engine
    trace = await start_trace(
        commander,
        page=page,
        output=str(tmp_path / "run"),
        mode="checkpoints",
        network=False,
        links=False,
        screenshots=True,
    )
    await trace.checkpoint("resized")
    stopped = await trace.stop()
    return read_trace(stopped["path"]).screenshot(1)


@pytest.mark.parametrize("engine", ["playwright", "puppeteer"])
@pytest.mark.parametrize("with_commander", [True, False])
async def test_checkpoint_without_fixed_viewport_sends_no_clip(
    tmp_path: Path, engine: str, with_commander: bool
) -> None:
    page, session = cdp_page(engine)
    shot = await checkpoint_shot(tmp_path, page, engine if with_commander else None)
    assert shot == b"cdp-png"
    session.send.assert_awaited_once_with("Page.captureScreenshot", VIEW)
    session.detach.assert_awaited_once()
    assert page.screenshots == 0


async def test_checkpoint_with_fixed_viewport_keeps_engine_capture(
    tmp_path: Path,
) -> None:
    page, session = cdp_page(viewport={"width": 800, "height": 600})
    assert await checkpoint_shot(tmp_path, page) == b"engine-png"
    session.send.assert_not_awaited()


async def test_checkpoint_falls_back_when_the_view_cannot_be_captured(
    tmp_path: Path,
) -> None:
    page, session = cdp_page(fail="Unable to capture screenshot")
    assert await checkpoint_shot(tmp_path, page) == b"engine-png"
    session.detach.assert_awaited_once()


async def test_checkpoint_on_a_page_without_cdp_keeps_engine_capture(
    tmp_path: Path,
) -> None:
    page = FakePage(make_snapshot())
    assert await checkpoint_shot(tmp_path, page) == b"fake-png"


@pytest.mark.parametrize("engine", ["playwright", "puppeteer"])
async def test_default_screenshot_without_fixed_viewport_sends_no_clip(
    engine: str,
) -> None:
    page, session = cdp_page(engine)
    assert await screenshot(page, engine=engine) == b"cdp-png"
    session.send.assert_awaited_once_with("Page.captureScreenshot", VIEW)
    assert page.screenshots == 0


@pytest.mark.parametrize("engine", ["playwright", "puppeteer"])
async def test_default_screenshot_with_fixed_viewport_keeps_engine_capture(
    engine: str,
) -> None:
    page, session = cdp_page(engine, viewport={"width": 800, "height": 600})
    assert await screenshot(page, engine=engine) == b"engine-png"
    session.send.assert_not_awaited()


@pytest.mark.parametrize(
    "options",
    [
        {"full_page": True},
        {"clip": {"x": 0, "y": 0, "width": 1, "height": 1}},
        {"omit_background": True},
        {"hide_scrollbars": True},
        {"disable_animations": True},
        {"scale": "css"},
        {"stable_viewport": False},
    ],
)
async def test_styled_or_region_screenshot_keeps_engine_capture(
    options: dict[str, Any],
) -> None:
    page, session = cdp_page()
    assert await screenshot(page, **options) == b"engine-png"
    session.send.assert_not_awaited()
