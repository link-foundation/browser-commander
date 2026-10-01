"""Tests for the trace recorder (issue #108).

A port of ``js/tests/unit/traces/recorder.test.js``, against the Python
recorder with test doubles in the shapes Python's Playwright uses.
"""

# feature-parity: trace.record@native-typed

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from browser_commander.factory import BrowserCommander
from browser_commander.traces import (
    REDACTED,
    TraceCheckpointReason,
    TraceDropReason,
    TraceEvent,
    TraceMode,
    TraceOutcome,
    TraceRecorder,
    read_trace,
    start_trace,
)
from tests.helpers.trace_fakes import (
    ActionCommander,
    FakeDownloads,
    FakePage,
    ObservingDialogManager,
    Payload,
    make_snapshot,
)

COMPLETED_DOWNLOAD = {
    "id": "download-1",
    "suggestedFilename": "report.pdf",
    "path": "/tmp/downloads/report.pdf",
    "checksum": "abc123",
    "bytes": 2048,
}


class Run:
    """A trace over a fake page and commander, and what it left behind."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory

    async def start(
        self,
        page: FakePage | None = None,
        commander: Any = "default",
        extras: dict[str, Any] | None = None,
        **options: Any,
    ) -> tuple[TraceRecorder, FakePage, Any]:
        page = page or FakePage(make_snapshot())
        if commander == "default":
            commander = ActionCommander(page, **(extras or {}))
        trace = await start_trace(
            commander, page=page, output=str(self.directory / "run"), **options
        )
        return trace, page, commander


@pytest.fixture
def run(tmp_path: Path) -> Run:
    return Run(tmp_path)


def events_of(stopped: dict[str, Any]) -> list[dict[str, Any]]:
    return read_trace(stopped["path"]).events


def event_of_kind(stopped: dict[str, Any], kind: str) -> dict[str, Any] | None:
    return next((e for e in events_of(stopped) if e["kind"] == kind), None)


def first_drop(stopped: dict[str, Any]) -> dict[str, Any]:
    dropped = event_of_kind(stopped, TraceEvent.DROPPED)
    assert dropped is not None
    return dropped


def timeline_text(stopped: dict[str, Any]) -> str:
    return Path(stopped["path"], "events.ndjson").read_text(encoding="utf-8")


class TestStarting:
    async def test_refuses_to_record_without_a_page(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="requires a page or a commander"):
            await start_trace(output=str(tmp_path / "run"))

    async def test_refuses_a_mode_it_does_not_know(self, run: Run) -> None:
        with pytest.raises(ValueError, match="trace mode must be one of"):
            await run.start(mode="sometimes")

    async def test_refuses_an_event_source_it_does_not_know(self, run: Run) -> None:
        with pytest.raises(ValueError, match="unknown trace event source"):
            await run.start(events=["telepathy"])

    async def test_refuses_an_option_it_does_not_know(self, run: Run) -> None:
        with pytest.raises(TypeError, match="unknown trace option"):
            await run.start(initialCheckpoint=False)

    async def test_opens_the_timeline_with_what_it_is_about_to_record(
        self, run: Run
    ) -> None:
        trace, _, _ = await run.start(mode=TraceMode.CHECKPOINTS)
        stopped = await trace.stop()

        started = events_of(stopped)[0]
        assert started["kind"] == TraceEvent.TRACE_START
        assert started["mode"] == TraceMode.CHECKPOINTS
        assert started["engine"] == "playwright"
        assert "console" in started["events"]

    async def test_records_mutations_without_being_asked_in_continuous_mode(
        self, run: Run
    ) -> None:
        trace, page, _ = await run.start(mode=TraceMode.CONTINUOUS)
        await trace.stop()

        assert page.calls("installMutationRecorderInPage")

    async def test_leaves_the_page_alone_when_mutations_are_not_recorded(
        self, run: Run
    ) -> None:
        trace, page, _ = await run.start(mode=TraceMode.CHECKPOINTS)
        await trace.stop()

        assert not page.calls("installMutationRecorderInPage")
        assert page.init_scripts == []


class TestCheckpoints:
    async def test_captures_html_live_state_and_a_screenshot_together(
        self, run: Run
    ) -> None:
        trace, _, _ = await run.start(screenshots=True)

        entry = await trace.checkpoint("after login", actor="user")
        stopped = await trace.stop()

        assert entry["index"] == 1
        assert entry["members"] == {
            "html": "checkpoints/0001.html",
            "state": "checkpoints/0001.state.json",
            "screenshot": "checkpoints/0001.png",
        }
        reader = read_trace(stopped["path"])
        assert "captured" in (reader.html(1) or "")
        state = reader.state(1)
        assert state is not None
        assert state["name"] == "after login"
        assert state["actor"] == "user"
        assert state["controls"][0]["value"] == "alice"
        assert reader.screenshot(1) == b"fake-png"

    async def test_does_not_take_a_screenshot_nobody_asked_for(self, run: Run) -> None:
        trace, page, _ = await run.start(screenshots=False)

        await trace.checkpoint("start")

        assert page.screenshots == 0
        await trace.stop()

    async def test_takes_a_screenshot_only_on_failure_when_asked(
        self, run: Run
    ) -> None:
        trace, page, _ = await run.start(screenshots="only-on-failure")

        await trace.checkpoint("start")
        assert page.screenshots == 0

        await trace.checkpoint("the end", reason="failure")
        assert page.screenshots == 1
        await trace.stop()

    async def test_keeps_a_gap_rather_than_fail_when_the_page_has_closed(
        self, run: Run
    ) -> None:
        trace, page, _ = await run.start(screenshots=False)
        page.failures["captureSnapshotInPage"] = RuntimeError(
            "Target page, context or browser has been closed"
        )

        entry = await trace.checkpoint("after the crash")
        stopped = await trace.stop()

        assert entry["members"] == {}
        dropped = first_drop(stopped)
        assert dropped["reason"] == TraceDropReason.PAGE_CLOSED
        assert dropped["member"] == "checkpoints/1"
        assert stopped["manifest"]["outcome"] == TraceOutcome.PARTIAL

    async def test_records_any_other_capture_failure(self, run: Run) -> None:
        trace, page, _ = await run.start(screenshots=False)
        page.failures["captureSnapshotInPage"] = RuntimeError("serializer broke")

        await trace.checkpoint("broken")
        stopped = await trace.stop()

        assert first_drop(stopped)["reason"] == "capture-failed"

    async def test_gives_a_capture_its_own_deadline(self, run: Run) -> None:
        page = FakePage(make_snapshot())
        page.hang = True
        trace, _, _ = await run.start(page=page, commander=None, capture_timeout_ms=20)

        await trace.checkpoint("hangs")
        stopped = await trace.stop()

        assert "timed out after 20ms" in first_drop(stopped)["detail"]

    async def test_refuses_a_checkpoint_after_the_trace_has_stopped(
        self, run: Run
    ) -> None:
        trace, _, _ = await run.start()
        await trace.stop()

        with pytest.raises(RuntimeError, match="already been stopped"):
            await trace.checkpoint("too late")

    async def test_reinstalls_the_mutation_recorder_a_navigation_threw_away(
        self, run: Run
    ) -> None:
        trace, page, _ = await run.start(mode=TraceMode.CONTINUOUS)

        await trace.checkpoint("after navigation")

        # Once at the start, and once after each of the two checkpoints - the
        # base one the recorder takes itself and the one named above.
        assert len(page.calls("installMutationRecorderInPage")) == 3
        await trace.stop()


class TestMutations:
    async def test_keeps_ordered_batches_between_checkpoints(self, run: Run) -> None:
        page = FakePage(
            make_snapshot(),
            mutations=[
                {"sequence": 1, "records": [{"type": "childList"}]},
                {"sequence": 2, "records": [{"type": "attributes"}]},
            ],
        )
        trace, _, _ = await run.start(page=page, mode=TraceMode.CONTINUOUS)

        await trace.checkpoint("after the update")
        stopped = await trace.stop()

        batches = read_trace(stopped["path"]).mutations(0)
        assert [batch["sequence"] for batch in batches] == [1, 2]

    async def test_records_that_the_page_dropped_mutations_of_its_own(
        self, run: Run
    ) -> None:
        page = FakePage(
            make_snapshot(), mutations=[{"sequence": 1, "records": []}], dropped=12
        )
        trace, _, _ = await run.start(page=page, mode=TraceMode.CONTINUOUS)

        await trace.checkpoint("after the storm")
        stopped = await trace.stop()

        dropped = first_drop(stopped)
        assert dropped["reason"] == TraceDropReason.SIZE_LIMIT
        assert "12 records" in dropped["detail"]


class TestContinuity:
    async def test_takes_a_base_snapshot_a_continuous_trace_can_replay_from(
        self, run: Run
    ) -> None:
        trace, _, _ = await run.start(mode=TraceMode.CONTINUOUS)
        stopped = await trace.stop()

        base = stopped["checkpoints"][0]
        assert base["name"] == "initial"
        assert base["actor"] == "recorder"
        assert base["reason"] == TraceCheckpointReason.INITIAL

    async def test_leaves_a_checkpoints_only_trace_the_moments_it_was_given(
        self, run: Run
    ) -> None:
        trace, _, _ = await run.start(mode=TraceMode.CHECKPOINTS)
        await trace.checkpoint("only this one")
        stopped = await trace.stop()

        assert [entry["name"] for entry in stopped["checkpoints"]] == ["only this one"]
        assert [entry["name"] for entry in trace.checkpoints] == ["only this one"]

    async def test_lets_the_caller_name_the_base_snapshot(self, run: Run) -> None:
        trace, _, _ = await run.start(
            mode=TraceMode.CONTINUOUS, initial_checkpoint="before anything"
        )
        stopped = await trace.stop()

        assert stopped["checkpoints"][0]["name"] == "before anything"

    async def test_lets_the_caller_refuse_the_base_snapshot(self, run: Run) -> None:
        trace, _, _ = await run.start(
            mode=TraceMode.CONTINUOUS, initial_checkpoint=False
        )
        stopped = await trace.stop()

        assert stopped["checkpoints"] == []
        started = event_of_kind(stopped, TraceEvent.TRACE_START)
        assert started is not None
        assert started["initialCheckpoint"] is False

    async def test_observes_a_document_created_after_the_trace_started(
        self, run: Run
    ) -> None:
        trace, page, _ = await run.start(mode=TraceMode.CONTINUOUS)
        await trace.stop()

        # Registered with the engine rather than evaluated: this is what runs
        # before a freshly navigated document's own scripts do.
        assert len(page.init_scripts) == 1
        assert "installMutationRecorderInPage" in page.init_scripts[0]

    async def test_asks_the_page_to_record_live_control_state(self, run: Run) -> None:
        trace, page, _ = await run.start(mode=TraceMode.CONTINUOUS)
        await trace.stop()

        assert page.calls("installMutationRecorderInPage")[0]["liveState"] is True

    async def test_stops_the_in_page_recorder_when_the_trace_stops(
        self, run: Run
    ) -> None:
        trace, page, _ = await run.start(mode=TraceMode.CONTINUOUS)
        await trace.stop()

        assert len(page.calls("stopMutationRecorderInPage")) == 1

    async def test_names_the_owner_of_every_timeline_record(self, run: Run) -> None:
        trace, _, _ = await run.start(mode=TraceMode.CONTINUOUS)
        stopped = await trace.stop()

        events = events_of(stopped)
        assert events
        for event in events:
            assert event["traceId"].startswith("trace-")
            assert event["pageId"].startswith("page-")
            assert event["navigationId"].startswith("nav-")

    async def test_names_the_action_a_recorded_interaction_belongs_to(
        self, run: Run
    ) -> None:
        trace, _, commander = await run.start()
        await commander.click("#submit")
        stopped = await trace.stop()

        interaction = event_of_kind(stopped, TraceEvent.INTERACTION)
        assert interaction is not None
        assert interaction["actionId"].startswith("trace-")
        assert interaction["actionId"].endswith("-action-1")

    async def test_separates_before_and_after_a_navigation(self, run: Run) -> None:
        trace, page, _ = await run.start(mode=TraceMode.CONTINUOUS)
        before = await trace.checkpoint("before")

        page.emit(
            "framenavigated",
            Payload(url="https://example.com/next", parent_frame=None),
        )
        await asyncio.sleep(0)

        after = await trace.checkpoint("after")
        stopped = await trace.stop()

        def owner(index: int) -> str:
            return next(
                event["navigationId"]
                for event in events_of(stopped)
                if event["kind"] == TraceEvent.CHECKPOINT and event["index"] == index
            )

        assert owner(before["index"]) != owner(after["index"])

    async def test_drains_every_frame_of_a_page(self, run: Run) -> None:
        page = FakePage(
            make_snapshot(),
            mutations=[{"sequence": 1, "at": 1, "records": []}],
            frames=[[{"sequence": 1, "at": 2, "records": []}]],
        )
        trace, _, _ = await run.start(page=page, mode=TraceMode.CONTINUOUS)
        stopped = await trace.stop()

        batches = read_trace(stopped["path"]).mutations(0)
        assert [batch["frameId"] for batch in batches] == ["main", "child-1"]
        assert [batch["mainFrame"] for batch in batches] == [True, False]

    async def test_says_what_the_bundle_can_actually_replay(self, run: Run) -> None:
        trace, _, _ = await run.start(mode=TraceMode.CONTINUOUS)
        stopped = await trace.stop()

        assert stopped["manifest"]["replay"] == {
            "checkpoints": True,
            "mutations": True,
            "childListPositions": True,
            "liveState": True,
            "identifiers": True,
        }

    async def test_admits_a_checkpoints_only_bundle_cannot_replay_the_gaps(
        self, run: Run
    ) -> None:
        trace, _, _ = await run.start(mode=TraceMode.CHECKPOINTS)
        stopped = await trace.stop()

        replay = stopped["manifest"]["replay"]
        assert replay["mutations"] is False
        assert replay["liveState"] is False
        assert replay["checkpoints"] is True


class TestSharedTimeline:
    async def test_orders_everything_as_it_happened(self, run: Run) -> None:
        downloads = FakeDownloads()
        trace, page, commander = await run.start(extras={"downloads": downloads})

        await commander.goto("https://example.com/login")
        page.emit("console", Payload(type="warning", text="slow"))
        page.emit("pageerror", Payload(message="boom", stack="Error: boom"))
        page.emit(
            "requestfailed",
            Payload(
                url="https://example.com/missing",
                method="GET",
                failure="net::ERR_FAILED",
            ),
        )
        page.emit("framenavigated", Payload(url="https://example.com/home"))
        downloads.emitter.emit("completed", COMPLETED_DOWNLOAD)
        stopped = await trace.stop()

        events = events_of(stopped)
        assert [event["kind"] for event in events] == [
            TraceEvent.TRACE_START,
            TraceEvent.INTERACTION,
            TraceEvent.CONSOLE,
            TraceEvent.PAGE_ERROR,
            TraceEvent.REQUEST_FAILED,
            TraceEvent.NAVIGATION,
            TraceEvent.DOWNLOAD,
            TraceEvent.TRACE_STOP,
        ]
        assert [event["sequence"] for event in events] == list(range(1, 9))

    async def test_references_a_download_by_path_and_checksum(self, run: Run) -> None:
        downloads = FakeDownloads()
        trace, _, _ = await run.start(extras={"downloads": downloads})

        downloads.emitter.emit(
            "completed",
            {
                **COMPLETED_DOWNLOAD,
                "url": "https://example.com/report.pdf?token=secret",
            },
        )
        stopped = await trace.stop()

        event = event_of_kind(stopped, TraceEvent.DOWNLOAD)
        assert event is not None
        assert event["path"] == "/tmp/downloads/report.pdf"
        assert event["checksum"] == "abc123"
        assert event["bytes"] == 2048
        assert event["url"] == f"https://example.com/report.pdf?token={REDACTED}"
        assert "contents" not in event

    async def test_records_an_interaction_without_what_was_typed(
        self, run: Run
    ) -> None:
        trace, _, commander = await run.start()

        await commander.type_text("#password", "hunter2")
        await commander.keyboard_press("Enter")
        stopped = await trace.stop()

        typed, pressed = [
            event
            for event in events_of(stopped)
            if event["kind"] == TraceEvent.INTERACTION
        ]
        assert typed["action"] == "typeText"
        assert typed["target"] == "#password"
        assert typed["ok"] is True
        # The key pressed is no more a target than the text typed.
        assert pressed["action"] == "pressKey"
        assert pressed["target"] is None
        assert "hunter2" not in timeline_text(stopped)

    async def test_reads_the_target_out_of_an_options_object(self, run: Run) -> None:
        trace, _, commander = await run.start()

        await commander.click({"selector": "#buy", "text": "hunter2"})
        await commander.goto(url="https://example.com/cart")
        stopped = await trace.stop()

        clicked, navigated = [
            event
            for event in events_of(stopped)
            if event["kind"] == TraceEvent.INTERACTION
        ]
        assert clicked["target"] == "#buy"
        assert navigated["target"] == "https://example.com/cart"
        assert "hunter2" not in timeline_text(stopped)

    async def test_records_an_interaction_that_failed_and_rethrows_it(
        self, run: Run
    ) -> None:
        page = FakePage(make_snapshot())
        commander = ActionCommander(page)

        async def covered(selector: str) -> None:
            raise RuntimeError("element is covered")

        commander.click = covered  # type: ignore[method-assign]
        trace, _, _ = await run.start(page=page, commander=commander)

        with pytest.raises(RuntimeError, match="element is covered"):
            await commander.click("#buy")
        stopped = await trace.stop()

        event = event_of_kind(stopped, TraceEvent.INTERACTION)
        assert event is not None
        assert event["ok"] is False
        assert event["error"] == "element is covered"
        # The commander's own replacement is back once the trace stops.
        assert commander.click is covered

    async def test_lets_a_caller_put_its_own_step_on_the_timeline(
        self, run: Run
    ) -> None:
        trace, _, _ = await run.start()

        await trace.event("paid the invoice", {"invoice": "INV-42"})
        stopped = await trace.stop()

        event = next(e for e in events_of(stopped) if e.get("actor") == "caller")
        assert event["action"] == "paid the invoice"
        assert event["invoice"] == "INV-42"

    async def test_records_a_dialog_without_taking_responsibility_for_it(
        self, run: Run
    ) -> None:
        dialogs = ObservingDialogManager()
        trace, _, _ = await run.start(extras={"dialog_manager": dialogs})

        dialog = await dialogs.raise_dialog("alert", "are you sure?")
        stopped = await trace.stop()

        event = event_of_kind(stopped, TraceEvent.DIALOG)
        assert event is not None
        assert event["type"] == "alert"
        assert event["message"] == "are you sure?"
        # Watching is not answering: the dialog is still dismissed.
        assert dialog.dismissed is True

    async def test_stops_watching_dialogs_when_the_trace_stops(self, run: Run) -> None:
        dialogs = ObservingDialogManager()
        trace, _, _ = await run.start(extras={"dialog_manager": dialogs})
        assert len(dialogs.observers) == 1

        await trace.stop()
        await dialogs.raise_dialog("confirm", "after")

        assert dialogs.observers == []

    async def test_only_observes_the_sources_the_caller_asked_for(
        self, run: Run
    ) -> None:
        trace, page, commander = await run.start(events=["console"])

        page.emit("console", Payload(type="log", text="hello"))
        await commander.goto("https://example.com")
        stopped = await trace.stop()

        kinds = [event["kind"] for event in events_of(stopped)]
        assert TraceEvent.CONSOLE in kinds
        assert TraceEvent.INTERACTION not in kinds

    async def test_stops_observing_once_the_trace_is_stopped(self, run: Run) -> None:
        trace, page, commander = await run.start()
        wrapped = commander.goto
        assert "goto" in vars(commander)

        stopped = await trace.stop()
        page.emit("console", Payload(type="log", text="after"))
        await commander.goto("https://example.com/after")

        assert page.emitter.count() == 0
        assert "goto" not in vars(commander)
        assert commander.goto != wrapped
        assert "after" not in timeline_text(stopped)


class TestPrivacy:
    async def test_keeps_a_secret_out_of_every_member_of_the_bundle(
        self, run: Run
    ) -> None:
        page = FakePage(
            make_snapshot(
                state={
                    "url": "https://example.com/report?access_token=super-secret",
                    "controls": [
                        {"path": "input#token", "tag": "input", "value": "super-secret"}
                    ],
                }
            )
        )
        trace, _, _ = await run.start(
            page=page,
            screenshots=False,
            privacy={"redact_patterns": ["super-secret"]},
        )

        await trace.checkpoint("after login")
        await trace.event("used the token", {"token": "super-secret"})
        stopped = await trace.stop()

        members = [p for p in Path(stopped["path"]).rglob("*") if p.is_file()]
        assert members
        for member in members:
            assert b"super-secret" not in member.read_bytes(), member.name

    async def test_records_the_privacy_settings_it_applied(self, run: Run) -> None:
        trace, _, _ = await run.start(
            privacy={"redact_selectors": [".card-number"], "redact": lambda _: "x"}
        )

        stopped = await trace.stop()

        privacy = stopped["manifest"]["privacy"]
        assert ".card-number" in privacy["redactSelectors"]
        assert privacy["hasCallback"] is True


class TestStopping:
    async def test_writes_a_readable_manifest_and_reports_the_checkpoints(
        self, run: Run
    ) -> None:
        trace, _, _ = await run.start()

        await trace.checkpoint("one")
        await trace.checkpoint("two")
        stopped = await trace.stop()

        manifest = stopped["manifest"]
        assert manifest["counts"]["checkpoints"] == 2
        assert manifest["outcome"] == TraceOutcome.COMPLETE
        assert manifest["stoppedAt"]
        assert [entry["name"] for entry in stopped["checkpoints"]] == ["one", "two"]
        assert trace.stopped is True
        assert trace.mode == TraceMode.CHECKPOINTS

    async def test_records_the_error_a_run_ended_with(self, run: Run) -> None:
        trace, _, _ = await run.start()

        stopped = await trace.stop(error=AssertionError("assertion failed"))

        fatal = next(
            event
            for event in events_of(stopped)
            if event["kind"] == TraceEvent.PAGE_ERROR and event.get("fatal")
        )
        assert fatal["message"] == "assertion failed"

    async def test_removes_a_bundle_it_was_told_to_discard(self, run: Run) -> None:
        trace, _, _ = await run.start()

        stopped = await trace.stop(discard=True)

        assert stopped["discarded"] is True
        assert not Path(stopped["path"]).exists()

    async def test_answers_the_same_way_when_stopped_twice(self, run: Run) -> None:
        trace, _, _ = await run.start()

        first = await trace.stop()
        second = await trace.stop()

        assert first is second


class PlaywrightLikePage(FakePage):
    """A fake page a real :class:`BrowserCommander` recognizes as Playwright."""

    def locator(self, selector: str) -> Any:
        return Payload(selector=selector)

    async def goto(self, url: str, **_: Any) -> None:
        return None


class TestBrowserCommanderStartTrace:
    async def test_records_through_the_commanders_own_managers(
        self, tmp_path: Path
    ) -> None:
        page = PlaywrightLikePage(make_snapshot())
        commander = BrowserCommander(
            page, enable_network_tracking=False, enable_navigation_manager=False
        )
        assert commander.dialog_manager is not None

        trace = await commander.start_trace(
            output=str(tmp_path / "run"),
            screenshots=False,
            links={"output": str(tmp_path / "run.lino")},
        )
        await trace.checkpoint("from the commander")
        dialog = Payload(type="alert", message="hello", dismissed=False)

        async def dismiss() -> None:
            dialog.dismissed = True

        dialog.dismiss = dismiss
        page.emit("dialog", dialog)
        await asyncio.sleep(0.01)
        stopped = await trace.stop()

        assert stopped["path"] == str((tmp_path / "run").resolve())
        assert Path(stopped["links"]).is_file()
        kinds = [event["kind"] for event in events_of(stopped)]
        assert TraceEvent.CHECKPOINT in kinds
        assert TraceEvent.DIALOG in kinds
        # The trace only watched; the manager still dismissed the dialog.
        assert dialog.dismissed is True
        assert commander.dialog_manager._observers == []
