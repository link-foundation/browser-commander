"""Portable screenshots and bounded recording without an external video binary."""

from __future__ import annotations

import asyncio
import io
import math
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal, cast

from PIL import Image

from browser_commander.capture_viewport import capture_stable_viewport
from browser_commander.core.engine_adapter import create_engine_adapter


class UnsupportedCaptureError(RuntimeError):
    """The requested capture capability is unavailable on this engine."""

    code = "UNSUPPORTED_CAPTURE"

    def __init__(self, capability: str, engine: str) -> None:
        self.capability = capability
        self.engine = engine
        super().__init__(f"{capability} is unsupported on {engine}")


@dataclass
class ScreenshotOptions:
    path: str | Path | None = None
    full_page: bool = False
    stable_viewport: bool = False
    selector: str | None = None
    clip: dict[str, float] | None = None
    format: Literal["png", "jpeg", "webp"] = "png"
    quality: int | None = None
    scale: Literal["css", "device"] = "device"
    omit_background: bool = False
    animations: Literal["allow", "disabled"] = "allow"
    caret: Literal["hide", "initial"] = "initial"
    hide_scrollbars: bool = False
    hide_caret: bool = False
    disable_animations: bool = False
    wait_for_fonts: bool = False


def _write(data: bytes, path: str | Path | None) -> bytes:
    if path is not None:
        target = Path(path)
        with target.open("wb") as output:
            target.chmod(0o600)
            output.write(data)
    return data


async def screenshot(
    page: Any,
    engine: str = "playwright",
    options: ScreenshotOptions | None = None,
    **kwargs: Any,
) -> bytes:
    opts = asdict(options) if options is not None else asdict(ScreenshotOptions())
    unknown = kwargs.keys() - opts.keys() - {"element"}
    if unknown:
        raise UnsupportedCaptureError(", ".join(sorted(unknown)), engine)
    opts.update(kwargs)
    fmt = opts["format"]
    if fmt not in {"png", "jpeg", "webp"}:
        raise UnsupportedCaptureError(fmt, engine)
    quality = opts["quality"]
    if quality is not None and (
        not isinstance(quality, int) or not 0 <= quality <= 100 or fmt == "png"
    ):
        raise ValueError("quality must be 0-100 for JPEG/WebP")
    if opts["scale"] not in {"css", "device"}:
        raise ValueError("scale must be css or device")
    if (
        sum(
            bool(value)
            for value in (
                opts["selector"] or opts.get("element"),
                opts["clip"],
                opts["full_page"],
            )
        )
        > 1
    ):
        raise ValueError("selector, clip and full_page are mutually exclusive")
    clip = opts["clip"]
    if clip and (
        any(not math.isfinite(clip[key]) for key in ("x", "y", "width", "height"))
        or clip["x"] < 0
        or clip["y"] < 0
        or clip["width"] <= 0
        or clip["height"] <= 0
    ):
        raise ValueError("invalid clip")
    if opts["animations"] not in {"allow", "disabled"} or opts["caret"] not in {
        "hide",
        "initial",
    }:
        raise ValueError("invalid animations/caret")
    if opts["stable_viewport"]:
        if (
            any(
                opts[key]
                for key in (
                    "full_page",
                    "selector",
                    "clip",
                    "omit_background",
                    "hide_scrollbars",
                    "hide_caret",
                    "disable_animations",
                )
            )
            or opts.get("element")
            or opts["animations"] != "allow"
            or opts["caret"] != "initial"
        ):
            raise ValueError(
                "stable_viewport requires the unmodified viewport: no region, background or visual styling options"
            )
        if engine not in {"playwright", "puppeteer", "selenium"}:
            raise UnsupportedCaptureError("stable viewport", engine)
        if opts["wait_for_fonts"]:
            if engine == "selenium":
                raise UnsupportedCaptureError("wait_for_fonts", engine)
            await page.evaluate("() => document.fonts.ready.then(() => true)")
        data = await capture_stable_viewport(page, engine, opts)
    elif engine == "playwright":
        if opts["wait_for_fonts"]:
            await page.evaluate("() => document.fonts.ready.then(() => true)")
        native = {
            "type": "png" if fmt == "webp" else fmt,
            "scale": opts["scale"],
            "animations": "disabled"
            if opts["disable_animations"]
            else opts["animations"],
            "caret": "initial",
            "omit_background": opts["omit_background"],
        }
        if fmt == "jpeg" and quality is not None:
            native["quality"] = quality
        style = (
            "*::-webkit-scrollbar{display:none!important}*{scrollbar-width:none!important}"
            if opts["hide_scrollbars"]
            else ""
        )
        if opts["hide_caret"] or opts["caret"] == "hide":
            style += "*{caret-color:transparent!important}"
        if style:
            native["style"] = style
        element = opts.get("element")
        if opts["selector"]:
            element = page.locator(opts["selector"]).first
        if element is not None:
            data = await element.screenshot(**native)
        else:
            native["full_page"] = opts["full_page"]
            if clip:
                native["clip"] = clip
            data = await page.screenshot(**native)
    elif engine == "puppeteer":
        data = await _puppeteer_screenshot(page, opts)
    elif engine == "selenium":
        unsupported = [
            key
            for key in (
                "full_page",
                "omit_background",
                "hide_scrollbars",
                "hide_caret",
                "disable_animations",
                "wait_for_fonts",
            )
            if opts[key]
        ]
        if opts["animations"] != "allow":
            unsupported.append("animations")
        if opts["caret"] != "initial":
            unsupported.append("caret")
        if unsupported:
            raise UnsupportedCaptureError(", ".join(unsupported), engine)
        element = opts.get("element")
        if opts["selector"]:
            from selenium.webdriver.common.by import By

            element = page.find_element(By.CSS_SELECTOR, opts["selector"])
        data = (
            element.screenshot_as_png
            if element is not None
            else page.get_screenshot_as_png()
        )
        image: Image.Image = Image.open(io.BytesIO(data))
        ratio = page.execute_script("return window.devicePixelRatio")
        if clip:
            x, y, width, height = (
                clip[key] * ratio for key in ("x", "y", "width", "height")
            )
            image = image.crop((x, y, x + width, y + height))
        if opts["scale"] == "css" and ratio != 1:
            image = image.resize(
                (round(image.width / ratio), round(image.height / ratio))
            )
        output = io.BytesIO()
        image.save(output, format="PNG")
        data = output.getvalue()
    else:
        raise UnsupportedCaptureError("screenshot", engine)
    if fmt == "webp" or (engine == "selenium" and fmt == "jpeg"):
        image = Image.open(io.BytesIO(data))
        output = io.BytesIO()
        image.convert("RGB" if fmt == "jpeg" else "RGBA").save(
            output, format=fmt.upper(), quality=quality if quality is not None else 75
        )
        data = output.getvalue()
    return _write(data, opts["path"])


async def _puppeteer_screenshot(page: Any, opts: dict[str, Any]) -> bytes:
    """Use the existing Puppeteer bridge while keeping options typed here."""
    native: dict[str, Any] = {
        "type": "png" if opts["format"] == "webp" else opts["format"],
        "fullPage": opts["full_page"],
        "omitBackground": opts["omit_background"],
    }
    if opts["clip"]:
        native["clip"] = opts["clip"]
    if opts["format"] == "jpeg" and opts["quality"] is not None:
        native["quality"] = opts["quality"]
    if opts["wait_for_fonts"]:
        await page.evaluate("() => document.fonts.ready.then(() => true)")
    style = ""
    if opts["hide_scrollbars"]:
        style += "*::-webkit-scrollbar{display:none!important}*{scrollbar-width:none!important}"
    if opts["hide_caret"] or opts["caret"] == "hide":
        style += "*{caret-color:transparent!important}"
    if opts["disable_animations"] or opts["animations"] == "disabled":
        style += (
            "*,*::before,*::after{animation:none!important;transition:none!important}"
        )
    marker = None
    try:
        if style:
            marker = await page.evaluate(
                "css => { const style=document.createElement('style'); "
                "style.id='browser-commander-capture-'+Math.random().toString(36).slice(2); "
                "style.textContent=css; document.documentElement.appendChild(style); return style.id; }",
                style,
            )
        target = opts.get("element")
        if opts["selector"]:
            target = await page.query_selector(opts["selector"])
            if target is None:
                raise ValueError(f"No element matches {opts['selector']}")
        if target is not None:
            native.pop("fullPage")
        data = bytes(await (target or page).screenshot(native))
        if opts["scale"] == "css":
            ratio = await page.evaluate("() => window.devicePixelRatio")
            if ratio != 1:
                if opts["format"] == "jpeg":
                    raise UnsupportedCaptureError("JPEG CSS scale", "puppeteer")
                with Image.open(io.BytesIO(data)) as image:
                    output = io.BytesIO()
                    image.resize(
                        (round(image.width / ratio), round(image.height / ratio))
                    ).save(output, "PNG")
                    data = output.getvalue()
        return data
    finally:
        if marker:
            await page.evaluate("id => document.getElementById(id)?.remove()", marker)


def encode_animation(
    frames: Sequence[bytes | str | Path],
    *,
    format: str = "gif",
    fps: float = 10,
    scale: float = 1,
    loop: int = 0,
    palette: int = 256,
    dither: bool = False,
    optimize: bool = True,
    quality: int = 75,
    path: str | Path | None = None,
) -> bytes:
    if not 1 <= fps <= 60 or not 0 < scale <= 8 or not 0 <= loop <= 65535:
        raise ValueError("invalid fps/scale/loop")
    if not 2 <= palette <= 256 or not 0 <= quality <= 100:
        raise ValueError("invalid palette/quality")
    if format not in {"gif", "apng", "webp"}:
        raise UnsupportedCaptureError(format, "animation encoder")
    if dither and format != "gif":
        raise UnsupportedCaptureError("dither", format)
    if not 1 <= len(frames) <= 1000:
        raise ValueError("animation requires 1-1000 frames")
    images = []
    total = 0
    for frame in frames:
        with Image.open(
            io.BytesIO(frame) if isinstance(frame, bytes) else frame
        ) as image:
            target = (
                max(1, round(image.width * scale)),
                max(1, round(image.height * scale)),
            )
            total += target[0] * target[1] * 4
            if image.width * image.height > 16_777_216 or total > 256 * 1024 * 1024:
                raise ValueError("decoded animation exceeds capture budget")
            converted = image.convert("RGBA").resize(target)
            if format == "gif":
                alpha = converted.getchannel("A")
                transparent = alpha.getextrema()[0] < 128  # type: ignore[operator]
                converted = converted.convert("RGB").quantize(
                    colors=palette - int(transparent),
                    dither=Image.Dither.FLOYDSTEINBERG if dither else Image.Dither.NONE,
                )
                if transparent:
                    index = palette - 1
                    converted.paste(
                        index, mask=alpha.point(lambda value: 255 if value < 128 else 0)
                    )
                    converted.info["transparency"] = index
            images.append(converted)
    if any(image.size != images[0].size for image in images):
        raise ValueError("frames must have equal dimensions")
    output = io.BytesIO()
    images[0].save(
        output,
        format="PNG" if format == "apng" else format.upper(),
        save_all=True,
        append_images=images[1:],
        duration=round(1000 / fps),
        loop=loop,
        optimize=optimize,
        quality=quality,
    )
    return _write(output.getvalue(), path)


class Recording:
    """A bounded screenshot recorder. stop() is idempotent and drains its task."""

    def __init__(self, page: Any, engine: str, options: dict[str, Any]) -> None:
        self.page, self.engine, self.options = page, engine, options
        self.frames: list[bytes] = []
        self.truncated = False
        self._stop = asyncio.Event()
        self._result: asyncio.Task | None = None
        self._task: asyncio.Task | None = None

    async def _record(self) -> None:
        started = asyncio.get_running_loop().time()
        total = sum(map(len, self.frames))
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(self._stop.wait(), 1 / self.options["fps"])
                break
            except asyncio.TimeoutError:
                pass
            if (
                len(self.frames) >= self.options["max_frames"]
                or (asyncio.get_running_loop().time() - started) * 1000
                >= self.options["max_duration_ms"]
            ):
                self.truncated = True
                break
            data = await screenshot(
                self.page, self.engine, **self.options.get("screenshot", {})
            )
            total += len(data)
            if total > self.options["max_bytes"]:
                self.truncated = True
                break
            self.frames.append(data)

    async def _finish(self, options: dict[str, Any]) -> dict[str, Any]:
        self._stop.set()
        if self._task is not None:
            await self._task
        opts = {**self.options, **options}
        fmt = opts.get("format", "webm")
        data = None
        if fmt in {"gif", "apng", "webp"}:
            keys = {
                "format",
                "fps",
                "scale",
                "loop",
                "palette",
                "dither",
                "optimize",
                "quality",
                "path",
            }
            data = encode_animation(
                self.frames,
                **{key: value for key, value in opts.items() if key in keys},
            )
        elif fmt != "frames":
            import base64

            from browser_commander.traces.engine import load_assets

            source = load_assets()["capture"]["encodeVideo"]
            adapter = create_engine_adapter(self.page, cast("Any", self.engine))
            result = await adapter.evaluate_on_page(
                f"({source})",
                {
                    "frames": [
                        base64.b64encode(frame).decode() for frame in self.frames
                    ],
                    "format": fmt,
                    "fps": opts["fps"],
                    "quality": opts.get("quality"),
                    "size": opts.get("size"),
                },
            )
            if result.get("unsupported"):
                raise UnsupportedCaptureError(fmt, self.engine)
            data = _write(bytes(result["data"]), opts.get("path"))
        return {
            "frames": self.frames,
            "bytes": data,
            "format": fmt,
            "truncated": self.truncated,
        }

    async def stop(self, **options: Any) -> dict[str, Any]:
        if self._result is None:
            self._result = asyncio.create_task(self._finish(options))
        return await asyncio.shield(self._result)


async def start_recording(
    page: Any, engine: str = "playwright", **options: Any
) -> Recording:
    opts = {
        "fps": 10,
        "max_frames": 1000,
        "max_bytes": 64 * 1024 * 1024,
        "max_duration_ms": 60_000,
        **options,
    }
    if (
        not 1 <= opts["fps"] <= 60
        or not 1 <= opts["max_frames"] <= 1000
        or opts["max_bytes"] < 1
        or opts["max_duration_ms"] < 1
    ):
        raise ValueError("invalid recording budget")
    fmt = opts.get("format", "webm")
    if fmt not in {"frames", "gif", "apng", "webp", "webm", "mp4"}:
        raise UnsupportedCaptureError(fmt, engine)
    if fmt in {"webm", "mp4"}:
        if engine != "playwright":
            raise UnsupportedCaptureError(fmt, engine)
        supported = await page.evaluate(
            "format => !!globalThis.MediaRecorder?.isTypeSupported('video/' + format)",
            fmt,
        )
        if not supported:
            raise UnsupportedCaptureError(fmt, engine)
    recording = Recording(page, engine, opts)
    recording.frames.append(
        await screenshot(page, engine, **opts.get("screenshot", {}))
    )
    if len(recording.frames[0]) > opts["max_bytes"]:
        raise ValueError("first frame exceeds max_bytes")
    recording._task = asyncio.create_task(recording._record())
    return recording
