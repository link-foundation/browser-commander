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
