"""Trace conformance with the JavaScript recorder (issue #108).

``scenario.json`` is replayed against the Python recorder with test doubles
and the result is compared, byte for byte, with what the JavaScript recorder
wrote for the same scenario (``expected/``). Only what a manifest says about
the machine - ``platform`` and ``runtime`` - is neutralized before comparing.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from browser_commander.traces import (
    format_trace_links,
    normalize_privacy_options,
    read_trace,
    redact_url,
    trace_links,
)
from tests.helpers.trace_fakes import (
    EXPECTED_DIR,
    normalize_machine,
    read_scenario,
    read_tree,
    record_conformance_scenario,
)


@pytest.fixture
async def recorded(tmp_path: Path) -> Path:
    await record_conformance_scenario(read_scenario(), tmp_path)
    return tmp_path


async def test_writes_the_bundle_javascript_writes(recorded: Path) -> None:
    manifest = json.loads((recorded / "bundle" / "manifest.json").read_text("utf-8"))
    got = normalize_machine(read_tree(recorded), manifest)
    expected = read_tree(EXPECTED_DIR)
    expected.pop("redaction.json")

    assert sorted(got) == sorted(expected)
    for name, data in expected.items():
        assert got[name] == data, f"{name} differs from the JavaScript recording"


async def test_streams_the_links_the_bundle_exports_afterwards(
    recorded: Path,
) -> None:
    streamed = (recorded / "trace.lino").read_bytes().decode("utf-8")
    assert format_trace_links(trace_links(recorded / "bundle")) == streamed
    assert format_trace_links(trace_links(read_trace(recorded / "bundle"))) == streamed


async def test_returns_what_the_javascript_recorder_returns(tmp_path: Path) -> None:
    result = await record_conformance_scenario(read_scenario(), tmp_path)

    assert result["path"] == str((tmp_path / "bundle").resolve())
    assert result["links"] == str((tmp_path / "trace.lino").resolve())
    assert result["manifest"]["outcome"] == "partial"
    assert [entry["name"] for entry in result["checkpoints"]] == [
        "initial",
        "after click",
        "final",
    ]
    assert [problem.get("reason") for problem in result["problems"]] == ["size-limit"]


def test_redacts_urls_as_javascript_does() -> None:
    scenario = read_scenario()
    privacy = normalize_privacy_options(scenario["options"]["privacy"])
    corpus = json.loads((EXPECTED_DIR / "redaction.json").read_text("utf-8"))

    assert corpus
    for entry in corpus:
        assert redact_url(entry["url"], privacy) == entry["redacted"], entry["url"]


async def test_covers_every_kind_of_timeline_event(recorded: Path) -> None:
    kinds = {event["kind"] for event in read_trace(recorded / "bundle").events}
    assert kinds >= {
        "trace.start",
        "checkpoint",
        "navigation",
        "console",
        "pageerror",
        "requestfailed",
        "dialog",
        "download",
        "interaction",
        "dropped",
        "mutations",
        "trace.stop",
    }
