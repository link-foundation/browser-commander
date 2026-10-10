"""Bound continuous traces and preserve independently readable rotated bundles."""

import asyncio
from pathlib import Path

from browser_commander.traces import read_trace, start_trace
from tests.helpers.trace_fakes import FakePage, make_snapshot


async def test_rotation_gzip_and_concurrent_stop(tmp_path: Path) -> None:
    trace = await start_trace(
        page=FakePage(make_snapshot()),
        output=tmp_path / "rolling",
        screenshots=False,
        limits={"rotate": {"maxBytes": 2048, "maxSegments": 2}, "gzip": True},
    )
    for _ in range(5):
        await trace.event("large", {"value": "a" * 700})
    first, second = await asyncio.gather(trace.stop(), trace.stop())
    assert first == second
    assert len(first["segments"]) == 2
    opened = read_trace(first["path"])
    assert any(event.get("action") == "large" for event in opened.events)
    assert list(Path(first["path"]).glob("segment-*/events.ndjson.gz"))
    assert len(list(Path(first["path"]).glob("segment-*"))) == 2


async def test_plain_stop_is_idempotent(tmp_path: Path) -> None:
    trace = await start_trace(
        page=FakePage(make_snapshot()), output=tmp_path / "plain", screenshots=False
    )
    first, second = await asyncio.gather(trace.stop(), trace.stop())
    assert first == second
    assert (
        sum(event["kind"] == "trace.stop" for event in read_trace(first["path"]).events)
        == 1
    )
