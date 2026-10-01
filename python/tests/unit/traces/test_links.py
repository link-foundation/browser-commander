"""Tests for the Links Notation export of a trace (issue #108).

A port of ``js/tests/unit/traces/links.test.js``. Python has no Links Notation
parser, so the export is read back with the small reader in the test helpers.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from browser_commander.traces import (
    TRACE_LINKS_SECTIONS,
    TRACE_LINKS_VERSION,
    TraceEvent,
    TraceMode,
    create_manifest,
    decode_link_text,
    encode_link_text,
    escape_reference,
    format_trace_links,
    open_trace_bundle,
    read_trace,
    start_trace,
    trace_links,
    write_trace_links,
)
from browser_commander.traces.links import timeline_link
from tests.helpers.trace_fakes import (
    FakeCommander,
    FakePage,
    make_snapshot,
    parse_links_export,
)

OWNER = {
    "traceId": "trace-1",
    "browserContextId": "context-1",
    "pageId": "page-1",
    "navigationId": "nav-1",
}


def write_bundle(directory: Path, close: bool = True) -> str:
    """Write a bundle holding one of everything the export has to say."""
    bundle = open_trace_bundle(directory / "run.bc-trace")
    bundle.append_event(
        {
            "kind": TraceEvent.TRACE_START,
            **OWNER,
            "mode": TraceMode.CONTINUOUS,
            "engine": "playwright",
        }
    )
    first = bundle.write_checkpoint(
        1,
        html="<html><body>one</body></html>",
        state={
            "url": "https://example.com/one",
            "controls": [
                {"path": "#name", "value": ""},
                {"path": "#terms", "value": "on", "checked": False},
            ],
        },
        screenshot=b"fake-png-bytes",
    )
    bundle.append_event(
        {
            "kind": TraceEvent.CHECKPOINT,
            **OWNER,
            "index": 1,
            "name": "loaded",
            "actor": "recorder",
            "reason": "initial",
            "url": "https://example.com/one",
            "members": first,
        }
    )
    bundle.append_event(
        {
            "kind": TraceEvent.INTERACTION,
            **OWNER,
            "actionId": "trace-1-action-1",
            "action": "click",
            "target": "#name[data-label='it\\'s here']",
            "durationMs": 12,
            "ok": True,
        }
    )
    bundle.append_event(
        {
            "kind": TraceEvent.CONSOLE,
            **OWNER,
            "level": "log",
            "text": "first line\nsecond line",
        }
    )
    bundle.append_event(
        {
            "kind": TraceEvent.INTERACTION,
            **OWNER,
            "action": "click",
            "target": "#missing",
            "ok": False,
            "error": "no element matched",
        }
    )
    member = bundle.write_mutations(1, [{"records": [{"kind": "childList"}]}])
    bundle.append_event(
        {
            "kind": TraceEvent.MUTATIONS,
            **OWNER,
            "member": member,
            "batches": 1,
            "checkpoint": 1,
            "frames": 1,
        }
    )
    bundle.drop(
        {"reason": "size-limit", "member": "checkpoints/2", "detail": "99 bytes"}
    )
    second = bundle.write_checkpoint(
        2,
        html="<html><body>two</body></html>",
        state={
            "url": "https://example.com/two",
            "controls": [
                {"path": "#name", "value": "ada"},
                {"path": "#terms", "value": "on", "checked": True},
            ],
        },
    )
    bundle.append_event(
        {
            "kind": TraceEvent.CHECKPOINT,
            **OWNER,
            "index": 2,
            "name": "filled in",
            "actor": "automation",
            "reason": "checkpoint",
            "url": "https://example.com/two",
            "members": second,
        }
    )
    if close:
        bundle.close(
            create_manifest(
                mode=TraceMode.CONTINUOUS,
                engine="playwright",
                started_at="2026-01-01T00:00:00.000Z",
                stopped_at="2026-01-01T00:00:10.000Z",
            )
        )
    else:
        bundle.abort()
    return bundle.root


def exported(
    root: str, directory: Path, include: list[str] | None = None
) -> tuple[str, list[dict[str, Any]]]:
    file = write_trace_links(read_trace(root), directory / "run.lino", include)
    text = Path(file).read_text(encoding="utf-8")
    return text, parse_links_export(text)


@pytest.fixture
def bundle_root(tmp_path: Path) -> str:
    return write_bundle(tmp_path)


def test_writes_one_link_per_timeline_event_in_order(
    bundle_root: str, tmp_path: Path
) -> None:
    _, links = exported(bundle_root, tmp_path)
    events = read_trace(bundle_root).events

    timeline = [link for link in links if link["id"] == "timeline"]
    assert len(timeline) == len(events)
    assert [int(link["fields"]["sequence"]) for link in timeline] == [
        event["sequence"] for event in events
    ]

    click = next(
        link["fields"]
        for link in timeline
        if link["fields"].get("action") == "click" and link["fields"]["outcome"] == "ok"
    )
    assert int(click["sequence"]) > 0
    assert click["at"].startswith("20")
    assert click["kind"] == TraceEvent.INTERACTION
    assert click["trace"] == "trace-1"
    assert click["context"] == "context-1"
    assert click["page"] == "page-1"
    assert click["navigation"] == "nav-1"
    assert click["actor"] == "automation"
    assert click["target"] == "#name[data-label='it\\'s here']"
    assert click["actionId"] == "trace-1-action-1"


def test_says_which_records_failed_were_dropped_or_are_partial(
    bundle_root: str, tmp_path: Path
) -> None:
    _, links = exported(bundle_root, tmp_path)
    outcomes = [link["fields"]["outcome"] for link in links if link["id"] == "timeline"]

    assert "ok" in outcomes
    assert "failed" in outcomes
    dropped = next(
        link["fields"]
        for link in links
        if link["id"] == "timeline" and link["fields"]["outcome"] == "dropped"
    )
    assert dropped["kind"] == TraceEvent.DROPPED
    assert dropped["reason"] == "size-limit"
    assert dropped["target"] == "checkpoints/2"

    result = next(link["fields"] for link in links if link["id"] == "result")
    assert result["outcome"] == "partial"
    assert result["dropped"] == "1"


def test_points_at_checkpoint_members_instead_of_copying_them(
    bundle_root: str, tmp_path: Path
) -> None:
    text, links = exported(bundle_root, tmp_path)
    checkpoints = [link["fields"] for link in links if link["id"] == "checkpoint"]

    assert len(checkpoints) == 2
    assert checkpoints[0]["name"] == "loaded"
    assert checkpoints[0]["html"] == "checkpoints/0001.html"
    assert checkpoints[0]["state"] == "checkpoints/0001.state.json"
    assert checkpoints[0]["screenshot"] == "checkpoints/0001.png"
    interval = next(
        link["fields"]
        for link in links
        if link["fields"].get("kind") == TraceEvent.MUTATIONS
    )
    assert interval["member"] == "mutations/0001.ndjson"
    assert interval["checkpoint"] == "1"
    assert "screenshot" not in checkpoints[1]

    for member in checkpoints[0].values():
        assert not Path(member).is_absolute()
    assert "fake-png-bytes" not in text
    assert "<html>" not in text


def test_writes_one_link_per_control_the_run_changed(
    bundle_root: str, tmp_path: Path
) -> None:
    _, links = exported(bundle_root, tmp_path)
    diffs = [link["fields"] for link in links if link["id"] == "control-diff"]

    assert [diff["path"] for diff in diffs] == ["#name", "#terms"]
    name, terms = diffs
    assert name["before"] == ""
    assert name["after"] == "ada"
    assert name["actor"] == "automation"
    assert name["checkpoint"] == "2"
    assert name["previous"] == "1"
    assert terms["before"] == "false"
    assert terms["after"] == "true"


def test_writes_only_the_sections_a_caller_asked_for(
    bundle_root: str, tmp_path: Path
) -> None:
    _, links = exported(
        bundle_root, tmp_path, ["timeline", "checkpoints", "control-diffs"]
    )
    assert {link["id"] for link in links} == {"checkpoint", "control-diff", "timeline"}

    _, only = exported(bundle_root, tmp_path, ["checkpoints"])
    assert {link["id"] for link in only} == {"checkpoint"}

    with pytest.raises(ValueError, match='unknown trace links section "everything"'):
        exported(bundle_root, tmp_path, ["everything"])


def test_survives_a_round_trip_through_a_links_notation_reader(
    bundle_root: str, tmp_path: Path
) -> None:
    text, links = exported(bundle_root, tmp_path)

    for line in filter(None, text.split("\n")):
        assert line.startswith("(")

    console = next(
        link["fields"]
        for link in links
        if link["fields"].get("kind") == TraceEvent.CONSOLE
    )
    assert console["text"] == "first line\nsecond line"

    for value in [
        "both'and\"",
        "line\nbreak",
        "tab\there",
        "back\\slash",
        "",
        "[redacted]",
        "plain",
    ]:
        assert decode_link_text(encode_link_text(value)) == value


@pytest.mark.parametrize(
    ("reference", "escaped"),
    [
        ("plain", "plain"),
        ("", '""'),
        ("#id", "'#id'"),
        ("issue#1047", "issue#1047"),
        ("two words", "'two words'"),
        ("it's", '"it\'s"'),
        ("a:b", "'a:b'"),
        ("(x)", "'(x)'"),
    ],
)
def test_quotes_a_reference_only_when_it_has_to(reference: str, escaped: str) -> None:
    assert escape_reference(reference) == escaped


async def test_keeps_the_same_secrets_the_bundle_keeps(tmp_path: Path) -> None:
    page = FakePage(
        make_snapshot(
            state={
                "controls": [
                    {
                        "path": "#password",
                        "tag": "input",
                        "type": "password",
                        "value": "hunter2",
                    }
                ]
            }
        )
    )
    trace = await start_trace(
        FakeCommander(page),
        output=str(tmp_path / "private.bc-trace"),
        links={"output": str(tmp_path / "private.lino")},
    )
    await trace.checkpoint("signed in")
    stopped = await trace.stop()

    text = Path(stopped["links"]).read_text(encoding="utf-8")
    bundle_text = Path(stopped["path"], "events.ndjson").read_text(encoding="utf-8")
    assert "hunter2" not in bundle_text
    assert "hunter2" not in text


async def test_streams_the_same_export_the_finished_bundle_produces(
    tmp_path: Path,
) -> None:
    page = FakePage(make_snapshot())
    trace = await start_trace(
        FakeCommander(page),
        mode=TraceMode.CONTINUOUS,
        output=str(tmp_path / "streamed.bc-trace"),
        links={"output": str(tmp_path / "streamed.lino")},
    )
    page.mutations.append({"records": [{"kind": "childList"}]})
    await trace.checkpoint("after the update")
    await trace.event("something the caller cared about")
    stopped = await trace.stop()

    streamed = Path(stopped["links"]).read_text(encoding="utf-8")
    afterwards = write_trace_links(
        read_trace(stopped["path"]), tmp_path / "afterwards.lino"
    )
    assert streamed == Path(afterwards).read_text(encoding="utf-8")
    assert streamed.startswith("(trace: ")
    assert "(result: " in streamed


async def test_leaves_a_readable_export_when_a_run_never_stops(
    tmp_path: Path,
) -> None:
    page = FakePage(make_snapshot())
    trace = await start_trace(
        FakeCommander(page),
        output=str(tmp_path / "killed.bc-trace"),
        links={"output": str(tmp_path / "killed.lino")},
    )
    await trace.checkpoint("as far as it got")

    links = parse_links_export(Path(trace.links).read_text(encoding="utf-8"))
    assert links[0]["id"] == "trace"
    assert any(link["id"] == "checkpoint" for link in links)
    assert not any(link["id"] == "result" for link in links)

    await trace.stop()


async def test_takes_the_export_away_with_a_discarded_bundle(
    tmp_path: Path,
) -> None:
    page = FakePage(make_snapshot())
    output = tmp_path / "discarded.lino"
    trace = await start_trace(
        FakeCommander(page),
        output=str(tmp_path / "discarded.bc-trace"),
        links={"output": str(output)},
    )
    await trace.checkpoint("never kept")
    await trace.stop(discard=True)

    assert not output.exists()
    assert not (tmp_path / "discarded.bc-trace").exists()


async def test_refuses_an_export_with_nowhere_to_write(tmp_path: Path) -> None:
    page = FakePage(make_snapshot())
    with pytest.raises(ValueError, match="trace links require an output path"):
        await start_trace(
            FakeCommander(page),
            output=str(tmp_path / "nowhere.bc-trace"),
            links={},
        )


def test_writes_the_representation_this_version_pins() -> None:
    text = format_trace_links(
        [
            timeline_link(
                {
                    "sequence": 7,
                    "at": "2026-01-01T00:00:03.000Z",
                    "monotonicMs": 1200,
                    "kind": TraceEvent.INTERACTION,
                    "traceId": "trace-1",
                    "browserContextId": "context-1",
                    "pageId": "page-1",
                    "navigationId": "nav-2",
                    "actionId": "trace-1-action-3",
                    "action": "click",
                    "target": "#add",
                    "durationMs": 12,
                    "ok": True,
                }
            )
        ]
    )

    assert text == (
        "(timeline: (sequence: 7) (at: '2026-01-01T00:00:03.000Z') "
        "(monotonicMs: 1200) (kind: interaction) (trace: trace-1) "
        "(context: context-1) (page: page-1) (navigation: nav-2) "
        "(actor: automation) (action: click) (target: '#add') (outcome: ok) "
        "(actionId: trace-1-action-3) (durationMs: 12) (ok: true))\n"
    )
    assert TRACE_LINKS_VERSION == 1
    assert list(TRACE_LINKS_SECTIONS) == [
        "trace",
        "timeline",
        "checkpoints",
        "control-diffs",
    ]


def test_exports_a_bundle_named_by_path_as_readily_as_an_open_one(
    bundle_root: str, tmp_path: Path
) -> None:
    file = write_trace_links(bundle_root, tmp_path / "by-path.lino")

    assert Path(file).read_text(encoding="utf-8") == format_trace_links(
        trace_links(bundle_root)
    )


def test_writes_inside_a_directory_given_as_the_output(
    bundle_root: str, tmp_path: Path
) -> None:
    target = tmp_path / "exports"
    target.mkdir()

    assert write_trace_links(bundle_root, target) == str(target / "trace.lino")
