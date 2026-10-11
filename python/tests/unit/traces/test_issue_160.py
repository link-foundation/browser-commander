"""Bounded regressions for private and continuously rotating traces."""

import json

import pytest

from browser_commander.traces import read_trace, start_trace
from browser_commander.traces.bundle import TraceBundle
from browser_commander.traces.redaction import normalize_privacy_options, redact_value
from tests.helpers.trace_fakes import ActionCommander, FakePage, make_snapshot


@pytest.mark.parametrize(
    "body",
    [
        '{"password":"PRIVATE_A","nested":{"otp":123456},"public":"visible"}',
        "password=PRIVATE_A&public=visible",
        '--b\r\nContent-Disposition: form-data; name="password"; filename="public.txt"\r\n\r\nPRIVATE_A\r\n--b--\r\n',
        '<script>const xsrfToken="PRIVATE_A\\"PRIVATE_B"; const otp=123456;</script>',
    ],
)
def test_private_bodies(body):
    value = json.dumps(redact_value({"postData": body}, normalize_privacy_options()))
    assert "PRIVATE_A" not in value
    assert "PRIVATE_B" not in value
    assert "123456" not in value


async def test_continuous_rotation_preserves_events_and_links(tmp_path):
    page = FakePage(make_snapshot(html="<div>" + "payload" * 1500 + "</div>"))
    trace = await start_trace(
        ActionCommander(page),
        page=page,
        output=str(tmp_path),
        mode="continuous",
        screenshots=False,
        limits={"maxBundleBytes": 2048},
        links={"output": str(tmp_path / "trace.lino"), "dom": "full"},
    )
    for index in range(8):
        await trace.checkpoint(f"checkpoint-{index}")
        await trace.event("step", {"index": index, "payload": "x" * 1500})
    await trace.stop()
    opened = read_trace(tmp_path)
    assert sum(event.get("action") == "step" for event in opened.events) == 8
    assert not any(event["kind"] == "dropped" for event in opened.events)
    sequences = [event["sequence"] for event in opened.events]
    assert sequences == sorted(set(sequences))
    assert len(json.loads((tmp_path / "segments.json").read_text())["segments"]) > 4
    assert "dom-snapshot" in (tmp_path / "trace.lino").read_text()


def test_mutation_interval_limit_recovers(tmp_path):
    bundle = TraceBundle(tmp_path, limits={"maxMutationBytes": 512})
    try:
        bundle.write_mutations(
            1, [{"records": [{"value": "first"}]}, {"records": [{"value": "x" * 1000}]}]
        )
        assert bundle.mutation_truncated
        assert bundle.write_mutations(1, [{"records": []}]) is None
        first = (tmp_path / "mutations/0001.ndjson").read_bytes()
        assert len(first) <= 512
        assert b"truncated" in first
        bundle.write_mutations(2, [{"records": [{"value": "next"}]}])
        assert not bundle.mutation_truncated
        assert "next" in (tmp_path / "mutations/0002.ndjson").read_text()
    finally:
        bundle.abort()


async def test_drops_and_rotation_keep_unique_sequences(tmp_path):
    page = FakePage(make_snapshot())
    trace = await start_trace(
        ActionCommander(page),
        page=page,
        output=str(tmp_path),
        mode="continuous",
        initial_checkpoint=False,
        screenshots=False,
        limits={"maxBundleBytes": 4096, "maxEventBytes": 1024},
    )
    await trace.event("oversized", {"payload": "x" * 2000})
    for index in range(8):
        await trace.event("step", {"index": index, "payload": "x" * 300})
    await trace.stop()
    opened = read_trace(tmp_path)
    assert sum(event["kind"] == "dropped" for event in opened.events) == 1
    assert sum(event.get("action") == "step" for event in opened.events) == 8
    assert len(json.loads((tmp_path / "segments.json").read_text())["segments"]) > 1
    sequences = [event["sequence"] for event in opened.events]
    assert sequences == sorted(set(sequences))
