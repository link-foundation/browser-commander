"""Unit tests for the readiness primitives."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable
from typing import Any, Callable

import pytest

from browser_commander.core.readiness import (
    LONG_LIVED_REQUEST_PATTERNS,
    CheckOutcome,
    Deadline,
    ReadinessCheck,
    ReadinessStatus,
    dom_stable_for,
    is_long_lived_request,
    network_idle_for,
    predicate,
    run_readiness_checks,
    run_within_deadline,
    sleep_within_deadline,
    stable_check,
    url_stable_for,
    visible_images,
)


class FakeClock:
    """Monotonic clock the test advances by hand.

    Budget assertions become exact instead of timing-dependent.
    """

    def __init__(self, start: float = 0) -> None:
        self.value = start

    def now(self) -> float:
        """Return the current time in seconds."""
        return self.value

    def advance(self, ms: float) -> None:
        """Advance the clock by milliseconds."""
        self.value += ms / 1000


class FakeTracker:
    """Network tracker stub with a scripted idle verdict."""

    def __init__(self, idle: bool, pending: list[str] | None = None) -> None:
        self.idle = idle
        self.pending = pending or []
        self.calls: list[dict[str, Any]] = []

    async def wait_for_network_idle(self, **kwargs: Any) -> bool:
        """Record the call and return the scripted verdict."""
        self.calls.append(kwargs)
        return self.idle

    def get_pending_count(self) -> int:
        """Return the number of pending requests."""
        return len(self.pending)

    def get_pending_urls(self) -> list[str]:
        """Return the pending request URLs."""
        return list(self.pending)


class FakeAdapter:
    """Adapter stub returning scripted page-evaluation results."""

    def __init__(self, results: list[Any]) -> None:
        self.results = list(results)
        self.calls = 0

    async def evaluate_on_page(self, _script: str, *_args: Any) -> Any:
        """Return the next scripted result, repeating the last one."""
        self.calls += 1
        if len(self.results) > 1:
            return self.results.pop(0)
        return self.results[0]


async def run_check(
    check: ReadinessCheck,
    context: dict[str, Any] | None = None,
    timeout: int = 2000,
) -> CheckOutcome:
    """Run one readiness check to completion under a fresh deadline."""
    return await check.run({"deadline": Deadline(timeout=timeout), **(context or {})})


class TestDeadline:
    def test_requires_a_non_negative_finite_timeout(self):
        with pytest.raises(ValueError, match="non-negative"):
            Deadline(timeout=-1)
        with pytest.raises(ValueError, match="non-negative"):
            Deadline(timeout=float("inf"))
        with pytest.raises(ValueError, match="non-negative"):
            Deadline(timeout=float("nan"))

    def test_reports_remaining_budget_that_only_shrinks(self):
        clock = FakeClock()
        deadline = Deadline(timeout=1000, now=clock.now)

        assert deadline.remaining_ms() == 1000
        assert deadline.expired() is False

        clock.advance(400)
        assert deadline.elapsed_ms() == 400
        assert deadline.remaining_ms() == 600

        clock.advance(900)
        assert deadline.remaining_ms() == 0
        assert deadline.expired() is True

    def test_never_hands_out_a_larger_budget_than_it_was_given(self):
        # Regression test for issue #89: the old code computed
        # max(60000, timeout - elapsed), so a 10ms budget became 60s.
        clock = FakeClock()
        deadline = Deadline(timeout=10, now=clock.now)

        clock.advance(5)
        assert deadline.remaining_ms() == 5

        clock.advance(100)
        assert deadline.remaining_ms() == 0
        assert deadline.expired() is True

    def test_calls_itself_expired_as_soon_as_nothing_is_left(self):
        # A check stops polling when remaining_ms() reaches zero, so a deadline
        # that still called itself live at that moment made the result blame the
        # check ("failed") for what was really the budget running out.
        clock = FakeClock()
        deadline = Deadline(timeout=20, now=clock.now)

        clock.advance(19.6)

        assert deadline.remaining_ms() == 0
        assert deadline.expired() is True

    async def test_sleep_is_capped_by_the_remaining_budget(self):
        deadline = Deadline(timeout=0)

        await sleep_within_deadline(10_000, deadline)

        assert deadline.remaining_ms() == 0


class TestIsLongLivedRequest:
    @pytest.mark.parametrize(
        "url",
        [
            "wss://example.com/live",
            "https://example.com/socket.io/?EIO=4",
            "https://example.com/api/event-stream",
            "https://www.google-analytics.com/g/collect",
            "https://example.com/telemetry",
        ],
    )
    def test_recognizes_requests_that_never_go_idle(self, url: str):
        assert is_long_lived_request(url) is True

    @pytest.mark.parametrize(
        "url",
        ["https://example.com/api/users", "https://example.com/app.js", "", None],
    )
    def test_leaves_ordinary_requests_alone(self, url: Any):
        assert is_long_lived_request(url) is False

    def test_exposes_its_patterns_for_callers_that_extend_them(self):
        assert len(LONG_LIVED_REQUEST_PATTERNS) > 0


class TestStableCheck:
    async def test_requires_the_sample_to_hold_for_the_whole_window(self):
        samples = [True, False, True, True, True, True, True, True]

        def sample(_context: dict[str, Any]) -> bool:
            return samples.pop(0) if samples else True

        outcome = await run_check(
            stable_check(
                name="probe",
                sample=sample,
                stable_for_ms=20,
                interval_ms=1,
            )
        )

        assert outcome.satisfied is True

    async def test_reports_the_reason_when_the_budget_runs_out(self):
        outcome = await run_check(
            stable_check(
                name="probe",
                sample=lambda _context: False,
                stable_for_ms=50,
                interval_ms=1,
            ),
            timeout=30,
        )

        assert outcome.satisfied is False
        assert outcome.detail["reason"] == "deadline reached"


class TestUrlStableFor:
    async def test_waits_out_a_redirect_chain(self):
        urls = ["https://a.test/", "https://b.test/", "https://b.test/"]
        seen: list[str] = []

        def get_url() -> str:
            return urls.pop(0) if len(urls) > 1 else urls[0]

        outcome = await run_check(
            url_stable_for(stable_for_ms=0, interval_ms=1),
            {"get_url": get_url, "on_url_sample": seen.append},
        )

        assert outcome.satisfied is True
        assert outcome.detail["url"] == "https://b.test/"
        assert seen[0] == "https://a.test/"


class TestNetworkIdleFor:
    async def test_is_skipped_without_a_tracker(self):
        outcome = await run_check(network_idle_for())

        assert outcome.skipped is True
        assert outcome.satisfied is False

    async def test_reports_failure_when_the_network_never_settles(self):
        # Regression test for issue #89: a tracker that answered "not idle" was
        # followed by a "page ready" log line and a True return.
        tracker = FakeTracker(idle=False, pending=["https://example.com/poll"])

        outcome = await run_check(network_idle_for(), {"network_tracker": tracker})

        assert outcome.satisfied is False
        assert outcome.detail["pendingUrls"] == ["https://example.com/poll"]

    async def test_hands_the_tracker_only_the_remaining_budget(self):
        tracker = FakeTracker(idle=True)

        await run_check(network_idle_for(), {"network_tracker": tracker}, timeout=250)

        assert tracker.calls[0]["timeout"] <= 250


class TestDomStableFor:
    async def test_waits_for_the_dom_to_stop_growing(self):
        adapter = FakeAdapter(
            [
                {"nodes": 10, "length": 100, "readyState": "complete"},
                {"nodes": 12, "length": 140, "readyState": "complete"},
                {"nodes": 12, "length": 140, "readyState": "complete"},
            ]
        )

        outcome = await run_check(
            dom_stable_for(stable_for_ms=0, interval_ms=1, consecutive_samples=1),
            {"adapter": adapter},
        )

        assert outcome.satisfied is True

    async def test_records_the_error_when_there_is_no_adapter(self):
        result = await run_readiness_checks(
            checks=[dom_stable_for(stable_for_ms=0, interval_ms=1)],
            deadline=Deadline(timeout=50),
        )

        assert result.ready is False
        assert "adapter" in result.evidence[0].detail["error"]


class TestVisibleImages:
    async def test_waits_for_images_in_the_viewport_to_decode(self):
        adapter = FakeAdapter([{"total": 2, "pending": 1}, {"total": 2, "pending": 0}])

        outcome = await run_check(visible_images(interval_ms=1), {"adapter": adapter})

        assert outcome.satisfied is True


class TestPredicate:
    async def test_requires_a_callable(self):
        with pytest.raises(TypeError, match="callable"):
            predicate(fn="nope")  # type: ignore[arg-type]

    async def test_polls_until_the_predicate_holds(self):
        answers = [False, False, True]

        outcome = await run_check(
            predicate(fn=lambda _context: answers.pop(0), interval_ms=1),
        )

        assert outcome.satisfied is True

    async def test_receives_the_check_context(self):
        seen: dict[str, Any] = {}

        def check_context(context: dict[str, Any]) -> bool:
            seen.update(context)
            return True

        await run_check(predicate(fn=check_context, interval_ms=1), {"marker": 42})

        assert seen["marker"] == 42
        assert isinstance(seen["deadline"], Deadline)


class TestRunReadinessChecks:
    async def test_reports_ready_only_when_every_check_passed(self):
        result = await run_readiness_checks(
            checks=[
                predicate(fn=lambda _c: True, name="first", interval_ms=1),
                predicate(fn=lambda _c: True, name="second", interval_ms=1),
            ],
            deadline=Deadline(timeout=200),
        )

        assert result.status == ReadinessStatus.READY
        assert result.ready is True
        assert result.satisfied == ["first", "second"]
        assert result.failed == []

    async def test_never_reports_ready_after_a_failed_check(self):
        # Regression test for issue #89: "Network did not become idle" was
        # immediately followed by "Page ready" and a True return.
        tracker = FakeTracker(idle=False)

        result = await run_readiness_checks(
            checks=[network_idle_for()],
            deadline=Deadline(timeout=100),
            context={"network_tracker": tracker},
        )

        assert result.ready is False
        assert result.status == ReadinessStatus.FAILED
        assert result.failed == ["network_idle_for"]

    async def test_reports_timed_out_when_the_budget_is_spent(self):
        result = await run_readiness_checks(
            checks=[
                predicate(fn=lambda _c: False, name="never", interval_ms=1),
            ],
            deadline=Deadline(timeout=20),
        )

        assert result.status == ReadinessStatus.TIMED_OUT
        assert result.ready is False

    async def test_lists_checks_that_never_ran_as_pending(self):
        result = await run_readiness_checks(
            checks=[
                predicate(fn=lambda _c: False, name="never", interval_ms=1),
                predicate(fn=lambda _c: True, name="unreached", interval_ms=1),
            ],
            deadline=Deadline(timeout=20),
        )

        assert result.failed == ["never"]
        assert result.pending == ["unreached"]

    async def test_a_skipped_check_does_not_block_readiness(self):
        result = await run_readiness_checks(
            checks=[network_idle_for()],
            deadline=Deadline(timeout=100),
        )

        assert result.skipped == ["network_idle_for"]
        assert result.ready is True

    async def test_attaches_timing_evidence_to_every_check(self):
        result = await run_readiness_checks(
            checks=[predicate(fn=lambda _c: True, name="probe", interval_ms=1)],
            deadline=Deadline(timeout=100),
        )

        record = result.evidence[0]
        assert record.name == "probe"
        assert record.satisfied is True
        assert record.elapsed_ms >= 0
        assert record.started_at_ms >= 0

    async def test_turns_a_raised_error_into_evidence(self):
        def explode(_context: dict[str, Any]) -> bool:
            raise RuntimeError("probe blew up")

        result = await run_readiness_checks(
            checks=[predicate(fn=explode, name="probe", interval_ms=1)],
            deadline=Deadline(timeout=100),
        )

        assert result.ready is False
        assert result.evidence[0].detail["error"] == "probe blew up"

    async def test_shares_one_budget_across_every_check(self):
        tracker = FakeTracker(idle=True)

        result = await run_readiness_checks(
            checks=[
                url_stable_for(stable_for_ms=0, interval_ms=1),
                network_idle_for(),
            ],
            deadline=Deadline(timeout=300),
            context={
                "get_url": lambda: "https://example.test/",
                "network_tracker": tracker,
            },
        )

        assert result.elapsed_ms <= 300
        assert result.timeout_ms == 300


def _answers(value: Any, after_ms: float = 0) -> Callable[[], Awaitable[Any]]:
    """Build an operation that answers with a value after a delay.

    Args:
        value: Value the operation resolves with
        after_ms: Delay before it answers, in milliseconds

    Returns:
        A zero-argument coroutine function
    """

    async def operation() -> Any:
        if after_ms:
            await asyncio.sleep(after_ms / 1000)
        return value

    return operation


class TestRunWithinDeadline:
    """The caller's budget has to win over an engine's own timeout."""

    @pytest.mark.parametrize(
        "make_deadline",
        [lambda: Deadline(timeout=1000), lambda: None],
        ids=["with deadline", "without deadline"],
    )
    async def test_returns_the_value_when_the_operation_answers_in_time(
        self,
        make_deadline: Callable[[], Deadline | None],
    ):
        outcome = await run_within_deadline(make_deadline(), _answers("done"))

        assert outcome.timed_out is False
        assert outcome.value == "done"

    async def test_reports_expiry_instead_of_waiting_the_operation_out(self):
        started = time.monotonic()

        outcome = await run_within_deadline(
            Deadline(timeout=30),
            _answers("too late", after_ms=5000),
        )

        assert outcome.timed_out is True
        assert outcome.value is None
        assert (time.monotonic() - started) < 2, (
            "the budget, not the probe, ends the wait"
        )

    async def test_does_not_start_an_operation_whose_budget_is_spent(self):
        clock = FakeClock()
        deadline = Deadline(timeout=50, now=clock.now)
        clock.advance(80)
        started = False

        async def operation() -> str:
            nonlocal started
            started = True
            return "ran"

        outcome = await run_within_deadline(deadline, operation)

        assert outcome.timed_out is True
        assert started is False

    async def test_propagates_a_failure_that_happens_in_time(self):
        async def operation() -> None:
            raise RuntimeError("probe blew up")

        with pytest.raises(RuntimeError, match="probe blew up"):
            await run_within_deadline(Deadline(timeout=1000), operation)

    async def test_absorbs_a_rejection_that_arrives_after_expiry(self):
        async def operation() -> None:
            await asyncio.sleep(0.2)
            raise RuntimeError("nobody is listening any more")

        outcome = await run_within_deadline(Deadline(timeout=20), operation)
        # The abandoned probe settles on its own schedule; if it were left to
        # surface, this sleep is where the loop would report it.
        await asyncio.sleep(0.3)

        assert outcome.timed_out is True
