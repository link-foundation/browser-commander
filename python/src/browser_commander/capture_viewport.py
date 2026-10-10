"""Read the existing native viewport without scrolling, resizing or styling it."""

from __future__ import annotations

import base64
import io
import re
from typing import Any

from PIL import Image


async def capture_stable_viewport(
    page: Any, engine: str, opts: dict[str, Any]
) -> bytes:
    fmt = "png" if opts["format"] == "webp" else opts["format"]
    session = None
    # Native-view capture bypasses emulated pixel density.
    emulated = getattr(page, "viewport_size", None) if engine == "playwright" else None
    if engine == "puppeteer" and hasattr(page, "viewport"):
        emulated = await page.viewport()
    try:
        if engine == "playwright" and not emulated and hasattr(page, "context"):
            session = await page.context.new_cdp_session(page)
        elif (
            engine == "puppeteer"
            and not emulated
            and hasattr(page, "create_cdp_session")
        ):
            session = await page.create_cdp_session()
    except Exception as error:
        if getattr(error, "name", "") != "UnsupportedOperation" and not re.search(
            r"only supported by Chromium|CDP.*not supported|CDP.*unsupported|CDP support is required|does not support CDP",
            str(error),
            re.I,
        ):
            raise
    data = None
    if session is not None:
        try:
            params = {
                "format": fmt,
                "fromSurface": False,
                "captureBeyondViewport": False,
            }
            if fmt == "jpeg" and opts["quality"] is not None:
                params["quality"] = opts["quality"]
            result = await session.send("Page.captureScreenshot", params)
            data = base64.b64decode(result["data"], validate=True)
        except Exception as error:
            if "unable to capture screenshot" not in str(error).lower():
                raise
        finally:
            await session.detach()
    if data is None:
        native: dict[str, Any] = {"type": fmt}
        if fmt == "jpeg" and opts["quality"] is not None:
            native["quality"] = opts["quality"]
        if engine == "playwright":
            return bytes(
                await page.screenshot(
                    **native, full_page=False, scale=opts["scale"], caret="initial"
                )
            )
        if engine == "puppeteer":
            data = bytes(await page.screenshot({**native, "fullPage": False}))
        else:
            data = page.get_screenshot_as_png()
    if opts["scale"] == "css":
        ratio = (
            page.execute_script("return window.devicePixelRatio")
            if engine == "selenium"
            else await page.evaluate("() => window.devicePixelRatio")
        )
        if ratio != 1:
            with Image.open(io.BytesIO(data)) as image:
                output = io.BytesIO()
                image.resize(
                    (round(image.width / ratio), round(image.height / ratio))
                ).save(
                    output,
                    "PNG" if engine == "selenium" else fmt.upper(),
                    **(
                        {
                            "quality": opts["quality"]
                            if opts["quality"] is not None
                            else 75
                        }
                        if fmt == "jpeg"
                        else {}
                    ),
                )
                data = output.getvalue()
    return data
