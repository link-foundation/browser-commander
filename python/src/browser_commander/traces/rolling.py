"""Bounded complete trace segments, each readable even after a controller crash."""

from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path
from typing import Any

from .bundle import write_private_file


class RollingTrace:
    def __init__(
        self,
        root: Path,
        options: dict[str, Any],
        start: Any,
        max_bytes: int,
        max_segments: int,
    ) -> None:
        self.path = str(root)
        self.mode = options.get("mode", "checkpoints")
        self._root, self._options, self._start = root, options, start
        self._max_bytes, self._max_segments = max_bytes, max_segments
        self._lock = asyncio.Lock()
        self._segments: list[str] = []
        self._sequence = 0
        self._current: Any = None
        self._stop_task: asyncio.Task[Any] | None = None
        self._timer: asyncio.Task[None] | None = None
        self._failure: Exception | None = None

    async def _open(self) -> None:
        self._sequence += 1
        name = f"segment-{self._sequence:06d}"
        limits = {
            **self._options["limits"],
            "rotate": False,
            "maxBundleBytes": self._max_bytes,
        }
        options = {**self._options, "output": self._root / name, "limits": limits}
        if options.get("links"):
            links = options["links"]
            options["links"] = {
                **(links if isinstance(links, dict) else {}),
                "output": str(self._root / name / "trace.lino"),
            }
        self._current = await self._start(**options)
        self._segments.append(name)
        while len(self._segments) > self._max_segments:
            shutil.rmtree(self._root / self._segments.pop(0))
        temporary = self._root / "segments.json.tmp"
        write_private_file(temporary, json.dumps({"segments": self._segments}).encode())
        temporary.replace(self._root / "segments.json")

    async def _rotate(self, extra: int = 0) -> None:
        if self._current._bundle.bytes_written + extra >= self._max_bytes * 0.8:
            await self._current.stop()
            await self._open()

    async def _tick(self) -> None:
        while True:
            await asyncio.sleep(0.1)
            async with self._lock:
                if self._stop_task:
                    return
                try:
                    await self._rotate()
                except Exception as error:
                    self._failure = error
                    return

    async def checkpoint(self, *args: Any, **kwargs: Any) -> Any:
        async with self._lock:
            if self._stop_task:
                raise RuntimeError("trace has stopped")
            await self._rotate()
            return await self._current.checkpoint(*args, **kwargs)

    async def event(self, *args: Any, **kwargs: Any) -> Any:
        async with self._lock:
            if self._stop_task:
                raise RuntimeError("trace has stopped")
            await self._rotate()
            await self._rotate(len(json.dumps([args, kwargs]).encode()) + 256)
            return await self._current.event(*args, **kwargs)

    async def _finish(self, **options: Any) -> dict[str, Any]:
        if self._timer:
            self._timer.cancel()
            await asyncio.gather(self._timer, return_exceptions=True)
        async with self._lock:
            result = await self._current.stop(**options)
            if options.get("discard"):
                shutil.rmtree(self._root, ignore_errors=True)
            if self._failure:
                raise self._failure
            return {**result, "path": self.path, "segments": list(self._segments)}

    async def stop(self, **options: Any) -> dict[str, Any]:
        if self._stop_task is None:
            self._stop_task = asyncio.create_task(self._finish(**options))
        return await asyncio.shield(self._stop_task)


async def start_rolling(options: dict[str, Any], start: Any) -> RollingTrace:
    limits = options["limits"]
    config = {} if limits["rotate"] is True else limits["rotate"]
    max_bytes = config.get(
        "maxBytes",
        limits.get("maxBundleBytes", limits.get("max_bundle_bytes", 32 * 1024 * 1024)),
    )
    max_segments = config.get("maxSegments", 4)
    if (
        not isinstance(max_bytes, int)
        or max_bytes < 1024
        or not isinstance(max_segments, int)
        or not 1 <= max_segments <= 100
    ):
        raise ValueError("invalid trace rotation bounds")
    root = Path(options["output"]).resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    trace = RollingTrace(root, options, start, max_bytes, max_segments)
    await trace._open()
    trace._timer = asyncio.create_task(trace._tick())
    return trace


def read_rolling(root: Path, index: dict[str, Any]) -> Any:
    from dataclasses import replace

    from .reader import Trace, TraceCheckpoint, read_trace

    events: list[dict[str, Any]] = []
    checkpoints: list[TraceCheckpoint] = []
    locations: dict[int, tuple[Trace, int]] = {}
    manifest: dict[str, Any] = {}
    truncated = False
    for segment in index["segments"]:
        if (
            not isinstance(segment, str)
            or not segment.startswith("segment-")
            or not segment[8:].isdigit()
        ):
            raise ValueError("invalid trace segment path")
        opened = read_trace(root / segment)
        manifest, truncated = opened.manifest, truncated or opened.truncated
        ids = {}
        for checkpoint in opened.checkpoints:
            number = len(checkpoints) + 1
            ids[checkpoint.index] = number
            locations[number] = (opened, checkpoint.index or 0)
            checkpoints.append(
                replace(
                    checkpoint,
                    index=number,
                    members={
                        key: f"{segment}/{value}"
                        for key, value in checkpoint.members.items()
                    },
                )
            )
        for event in opened.events:
            mapped = {**event, "segment": segment}
            if event["kind"] == "checkpoint":
                mapped["index"] = ids[event["index"]]
            if event["kind"] == "mutations":
                mapped["checkpoint"] = ids.get(event["checkpoint"], 0)
            events.append(mapped)

    class SegmentedTrace(Trace):
        def html(self, index: int) -> str | None:
            return (
                locations[index][0].html(locations[index][1])
                if index in locations
                else None
            )

        def state(self, index: int) -> dict[str, Any] | None:
            return (
                locations[index][0].state(locations[index][1])
                if index in locations
                else None
            )

        def screenshot(self, index: int) -> bytes | None:
            return (
                locations[index][0].screenshot(locations[index][1])
                if index in locations
                else None
            )

        def mutations(self, index: int) -> list[dict[str, Any]]:
            return (
                locations[index][0].mutations(locations[index][1])
                if index in locations
                else []
            )

    return SegmentedTrace(str(root), manifest, events, checkpoints, truncated)
