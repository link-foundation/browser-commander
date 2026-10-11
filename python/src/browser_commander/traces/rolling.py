"""Compatibility entry point for write-boundary trace rotation."""

from __future__ import annotations

from pathlib import Path
from typing import Any


async def start_rolling(options: dict[str, Any], start: Any) -> Any:
    """Use the normal recorder with its rotating bundle writer."""
    return await start(**options)


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
