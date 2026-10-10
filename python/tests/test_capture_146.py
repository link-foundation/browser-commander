import io
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from PIL import Image

from browser_commander.capture import (
    UnsupportedCaptureError,
    encode_animation,
    screenshot,
    start_recording,
)


def png(color):
    output = io.BytesIO()
    Image.new("RGBA", (8, 8), color).save(output, format="PNG")
    return output.getvalue()


@pytest.mark.parametrize("format", ["gif", "apng", "webp"])
def test_two_frames_and_transparency(format):
    data = encode_animation(
        [png((255, 0, 0, 0)), png((0, 0, 255, 255))], format=format, scale=2, fps=5
    )
    with Image.open(io.BytesIO(data)) as image:
        assert image.n_frames == 2
        assert image.size == (16, 16)
        assert image.convert("RGBA").getpixel((0, 0))[3] == 0


async def test_clean_caret_does_not_use_mutating_native_option():
    page = SimpleNamespace(screenshot=AsyncMock(return_value=png("red")))
    await screenshot(page, hide_caret=True)
    options = page.screenshot.call_args.kwargs
    assert options["caret"] == "initial"
    assert "caret-color" in options["style"]


async def test_recording_is_bounded_and_stop_is_idempotent():
    page = SimpleNamespace(screenshot=AsyncMock(return_value=png("red")))
    recorder = await start_recording(page, format="frames", max_frames=1)
    result = await recorder.stop()
    assert await recorder.stop() is result
    assert len(result["frames"]) == 1


async def test_unsupported_capture_is_typed():
    with pytest.raises(UnsupportedCaptureError):
        await screenshot(SimpleNamespace(), engine="selenium", full_page=True)


@pytest.mark.parametrize("engine", ["playwright", "puppeteer"])
async def test_stable_viewport_uses_view_capture_and_detaches(engine):
    import base64

    session = SimpleNamespace(
        send=AsyncMock(return_value={"data": base64.b64encode(png("red")).decode()}),
        detach=AsyncMock(),
    )
    page = SimpleNamespace(
        context=SimpleNamespace(new_cdp_session=AsyncMock(return_value=session)),
        create_cdp_session=AsyncMock(return_value=session),
        screenshot=AsyncMock(side_effect=AssertionError("must use view capture")),
    )
    assert await screenshot(page, engine=engine, stable_viewport=True) == png("red")
    session.send.assert_awaited_once_with(
        "Page.captureScreenshot",
        {
            "format": "png",
            "fromSurface": False,
            "captureBeyondViewport": False,
        },
    )
    session.detach.assert_awaited_once()


async def test_stable_viewport_fallback_is_never_full_page():
    session = SimpleNamespace(
        send=AsyncMock(side_effect=RuntimeError("Unable to capture screenshot")),
        detach=AsyncMock(),
    )
    page = SimpleNamespace(
        context=SimpleNamespace(new_cdp_session=AsyncMock(return_value=session)),
        screenshot=AsyncMock(return_value=png("red")),
    )
    assert await screenshot(page, stable_viewport=True) == png("red")
    assert page.screenshot.call_args.kwargs["full_page"] is False
    session.detach.assert_awaited_once()


@pytest.mark.parametrize("engine", ["playwright", "puppeteer"])
async def test_stable_emulated_viewports_preserve_pixel_scaling(engine):
    page = SimpleNamespace(
        viewport_size={"width": 320, "height": 200},
        viewport=AsyncMock(return_value={"width": 320, "height": 200}),
        context=SimpleNamespace(
            new_cdp_session=AsyncMock(
                side_effect=AssertionError("native view ignores emulation")
            )
        ),
        create_cdp_session=AsyncMock(
            side_effect=AssertionError("native view ignores emulation")
        ),
        screenshot=AsyncMock(return_value=png("red")),
    )
    assert await screenshot(page, engine=engine, stable_viewport=True) == png("red")


async def test_stable_viewport_puppeteer_bidi_fallback():
    from browser_commander.puppeteer.bridge import BridgeError

    page = SimpleNamespace(
        create_cdp_session=AsyncMock(
            side_effect=BridgeError("", name="UnsupportedOperation")
        ),
        screenshot=AsyncMock(return_value=png("red")),
    )
    assert await screenshot(page, engine="puppeteer", stable_viewport=True) == png(
        "red"
    )
    assert page.screenshot.call_args.args[0]["fullPage"] is False


@pytest.mark.parametrize(
    "options",
    [
        {"full_page": True},
        {"selector": "#pager"},
        {"hide_caret": True},
        {"omit_background": True},
    ],
)
async def test_stable_viewport_rejects_visual_changes(options):
    with pytest.raises(ValueError, match="stable_viewport"):
        await screenshot(
            SimpleNamespace(screenshot=AsyncMock()), stable_viewport=True, **options
        )
