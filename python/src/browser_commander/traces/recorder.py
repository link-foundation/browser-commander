"""The trace recorder (issue #108).

A port of ``js/src/traces/recorder.js``. A consumer starts a recorder, names
checkpoints and stops it. Nothing in that path requires the raw Playwright
page or Selenium driver: the recorder is the thing that knows how each engine
reports a console message or a failed request, so every caller does not have
to.

The bundle it writes is the bundle the JavaScript recorder writes for the same
run - the same layout, the same records and the same bytes - because the
in-page capture code is the JavaScript recorder's own (``assets.json``) and
every value is serialized the way ``JSON.stringify`` serializes it.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import shutil
import traceback
from collections.abc import Mapping
from typing import Any, Callable

from browser_commander.capture import Recording
from browser_commander.core.logger import Logger

from .bundle import (
    DEFAULT_CAPTURE_TIMEOUT,
    TraceBundle,
    default_now,
    normalize_limits,
    open_trace_bundle,
)
from .engine import EngineDriver, error_message, load_assets, with_deadline
from .identity import create_trace_identity
from .jsonfmt import UNDEFINED, coalesce, iso_timestamp, js_string, js_truthy
from .links import TraceLinksSink, open_trace_links
from .mutation_stream import MutationStream
from .network import NetworkRecorder, write_har
from .observers import attach_timeline_observers
from .reader import read_trace
from .redaction import (
    REDACTED,
    normalize_privacy_options,
    redact_url,
    redact_value,
)
from .schema import (
    TRACE_EVENT_SOURCES,
    TRACE_SCHEMA_VERSION,
    TraceCheckpointReason,
    TraceDropReason,
    TraceEvent,
    TraceMode,
    TraceOutcome,
    create_manifest,
)

#: DOM capture defaults: what a checkpoint holds unless the caller narrows it.
DEFAULT_DOM_OPTIONS = {
    "html": True,
    "liveControlState": True,
    # Record what typing, checking, selecting, focus and scroll did, as it
    # happens, so a replay does not show an empty field a moment after the
    # user finished filling it in.
    "liveState": True,
    "mutations": False,
    "openShadowRoots": True,
}

_DOM_KEYS = {
    "live_control_state": "liveControlState",
    "live_state": "liveState",
    "open_shadow_roots": "openShadowRoots",
}

_TRACE_MODES = (
    TraceMode.OFF,
    TraceMode.CHECKPOINTS,
    TraceMode.CONTINUOUS,
    TraceMode.RETAIN_ON_FAILURE,
)

_OPTIONS = frozenset(
    {
        "output",
        "mode",
        "initial_checkpoint",
        "screenshots",
        "dom",
        "events",
        "privacy",
        "limits",
        "links",
        "network",
        "video",
        "checkpoint_on_navigation",
        "strict",
        "capture_timeout_ms",
        "commander_version",
        "log",
        "now",
        "monotonic",
    }
)


def _normalize_mode(mode: Any) -> str:
    if mode not in _TRACE_MODES:
        raise ValueError(f"trace mode must be one of {', '.join(_TRACE_MODES)}")
    return mode


def _normalize_events(events: Any) -> list[str]:
    if events is False:
        return []
    if events is None or events is True:
        return list(TRACE_EVENT_SOURCES)
    if not isinstance(events, (list, tuple)):
        raise TypeError("trace events must be an array of event names")
    for name in events:
        if name not in TRACE_EVENT_SOURCES:
            raise ValueError(
                f'unknown trace event source "{js_string(name)}"; expected one of '
                f"{', '.join(TRACE_EVENT_SOURCES)}"
            )
    return list(dict.fromkeys(events))


def _normalize_links(links: Any) -> dict[str, Any] | None:
    """Accept ``{"output": ..., "include": [...]}`` or a bare output path.

    Like JavaScript, only an absent export (``None``, ``False`` or ``""``)
    means none: ``{}`` is an export with nowhere to write, and is refused.
    """
    if links is None or links is False or links == "":
        return None
    if isinstance(links, (str, os.PathLike)):
        links = {"output": links}
    if not isinstance(links, Mapping):
        raise TypeError("trace links must be an object with an output path")
    output = links.get("output")
    if isinstance(output, os.PathLike):
        output = os.fspath(output)
    if not isinstance(output, str) or output == "":
        raise ValueError("trace links require an output path")
    return {"output": output, "include": links.get("include"), "dom": links.get("dom")}


def _error_stack(error: Any) -> str | None:
    stack = getattr(error, "stack", None)
    if isinstance(stack, str):
        return stack
    if isinstance(error, BaseException) and error.__traceback__ is not None:
        return "".join(
            traceback.format_exception(type(error), error, error.__traceback__)
        )
    return None


def _note_through(log: Any) -> Callable[[str], None]:
    def note(message: str) -> None:
        debug = getattr(log, "debug", None)
        if not callable(debug):
            return
        text = f"[trace] {message}"
        # Browser Commander's logger takes a message factory; any other
        # logger takes the message.
        with contextlib.suppress(Exception):
            debug((lambda: text) if isinstance(log, Logger) else text)

    return note


class TraceRecorder:
    """A running trace. Create it with :func:`start_trace`.

    Attributes:
        path: The bundle directory
        links: The Links Notation export, or None
        mode: What the recorder captures
    """

    def __init__(
        self,
        *,
        commander: Any,
        page: Any,
        output: Any,
        mode: str,
        initial_checkpoint: Any,
        screenshots: Any,
        dom: Mapping[str, Any],
        events: Any,
        privacy: Any,
        limits: Any,
        links: Any,
        network: Any,
        video: Any,
        strict: bool,
        capture_timeout_ms: float | None,
        commander_version: str | None,
        log: Any,
        now: Callable[[], float] | None,
        monotonic: Callable[[], float] | None,
    ) -> None:
        self._network_options = network
        self._network = NetworkRecorder(page, network, self.record, _note_through(log))
        self._video_options = video
        self._video: Recording | None = None
        self._links_dom = links.get("dom") if isinstance(links, Mapping) else None
        self.mode = _normalize_mode(mode)
        dom = {_DOM_KEYS.get(key, key): value for key, value in dict(dom or {}).items()}
        self._dom = {**DEFAULT_DOM_OPTIONS, **dom}
        if self.mode == TraceMode.CONTINUOUS and dom.get("mutations") is not False:
            self._dom["mutations"] = True
        self._events = _normalize_events(events)
        self._privacy = normalize_privacy_options(privacy)
        self._limits = normalize_limits(limits)
        # Validated before the bundle opens, so a rejected start does not
        # strand an open timeline that no running trace is there to stop.
        links_options = _normalize_links(links)
        engine = getattr(commander, "engine", None) if commander is not None else None
        self._engine = js_string(engine) if engine is not None else None
        self._commander = commander
        self._page = page
        self._driver = EngineDriver(page, self._engine)
        self._identity = create_trace_identity(page)
        self._screenshots = screenshots
        self._timeout = capture_timeout_ms
        self._commander_version = commander_version
        self._now = now or default_now
        self.note = _note_through(log)

        # A continuous trace records changes, and a change is only meaningful
        # against something, so it takes a base snapshot by default; a
        # checkpoints-only trace adds nothing uninvited. A string names it.
        self._base_checkpoint = coalesce(
            initial_checkpoint, self.mode == TraceMode.CONTINUOUS
        )

        self._links_sink: TraceLinksSink | None = None
        self._bundle: TraceBundle = open_trace_bundle(
            output,
            limits=self._limits,
            strict=strict,
            now=self._now,
            monotonic=monotonic,
            on_event=self._stream_link,
        )
        self._started_at = iso_timestamp(self._now())
        if links_options:
            try:
                self._links_sink = open_trace_links(
                    links_options["output"],
                    include=links_options["include"],
                    dom=links_options["dom"],
                    bundle_path=self._bundle.root,
                    schemaVersion=TRACE_SCHEMA_VERSION,
                    mode=self.mode,
                    engine=self._engine,
                    startedAt=self._started_at,
                    commanderVersion=commander_version,
                )
            except Exception:
                self._bundle.abort()
                raise

        self._stopped: dict[str, Any] | None = None
        self._stopping = False
        self._stop_task: asyncio.Task[dict[str, Any]] | None = None
        self._periodic: asyncio.Task[None] | None = None
        self._navigation_tasks: set[asyncio.Task[Any]] = set()
        self._capture_lock = asyncio.Lock()
        self._checkpoint_index = 0
        self._checkpoints: list[dict[str, Any]] = []
        self._detachers: list[Callable[[], Any]] = []
        self._mutations = MutationStream(
            driver=self._driver,
            bundle=self._bundle,
            record=self.record,
            identity=self._identity,
            note=self.note,
            dom_options=self._dom,
            privacy=self._privacy,
            limits=self._limits,
            capture_timeout_ms=self._timeout,
            evaluate_in_page=self._driver.evaluate,
        )

    def _stream_link(self, event: dict[str, Any]) -> None:
        if self._links_sink is not None:
            self._links_sink.event(event)

    async def _start(self) -> None:
        self._network.start()
        if self._video_options:
            from browser_commander.capture import start_recording

            self._video = await start_recording(
                self._page,
                self._engine or "playwright",
                **({} if self._video_options is True else self._video_options),
            )
        self._detachers = attach_timeline_observers(
            commander=self._commander,
            driver=self._driver,
            event_sources=self._events,
            record=self.record,
            note=self.note,
            identity=self._identity,
            now=self._now,
        )
        # Registered before the first record, so a navigation that starts as
        # the trace does is still recorded from its first mutation.
        detach_init_script = await self._mutations.install_persistent()
        if detach_init_script:
            self._detachers.append(detach_init_script)

        self.record(
            TraceEvent.TRACE_START,
            {
                "mode": self.mode,
                "engine": self._engine,
                "dom": self._dom,
                "events": self._events,
                "initialCheckpoint": js_truthy(self._base_checkpoint),
            },
        )
        await self._mutations.install()

        if js_truthy(self._base_checkpoint):
            name = (
                self._base_checkpoint
                if isinstance(self._base_checkpoint, str)
                else "initial"
            )
            await self.checkpoint(
                name, actor="recorder", reason=TraceCheckpointReason.INITIAL
            )

        if self._dom.get("mutations"):

            async def drain_periodically() -> None:
                while True:
                    await asyncio.sleep(0.5)
                    async with self._capture_lock:
                        await self._mutations.drain(self._checkpoint_index)

            self._periodic = asyncio.create_task(drain_periodically())

    # ------------------------------------------------------------------ state

    @property
    def path(self) -> str:
        """The bundle directory."""
        return self._bundle.root

    @property
    def links(self) -> str | None:
        """The Links Notation export, or None when none is written."""
        return self._links_sink.path if self._links_sink else None

    @property
    def stopped(self) -> bool:
        """Whether :meth:`stop` has run."""
        return self._stopped is not None or self._stopping

    @property
    def checkpoints(self) -> list[dict[str, Any]]:
        """The checkpoints taken so far."""
        return list(self._checkpoints)

    # -------------------------------------------------------------- recording

    def record(self, kind: str, payload: Mapping[str, Any] | None = None) -> Any:
        """Record an event on the shared timeline.

        Args:
            kind: One of :class:`TraceEvent`
            payload: Event fields, redacted before writing

        Returns:
            The written event, or None
        """
        if self._stopping and kind != TraceEvent.TRACE_STOP:
            return None
        return self._bundle.append_event(
            {
                "kind": kind,
                # Who this happened to comes first so a payload that knows
                # better - a drain naming its frame, say - can say so.
                **self._identity.owner(),
                **redact_value(dict(payload or {}), self._privacy),
            }
        )

    async def event(
        self, name: str, data: Mapping[str, Any] | None = None
    ) -> dict[str, Any] | None:
        """Record an event a caller cares about on the same timeline.

        Args:
            name: What happened
            data: Details, redacted before writing

        Returns:
            The written event, or None
        """
        return self.record(
            TraceEvent.INTERACTION,
            {"action": name, "actor": "caller", **dict(data or {})},
        )

    async def _screenshot(self, reason: str) -> bytes | None:
        wanted = (
            self._screenshots is True
            or self._screenshots == "checkpoints"
            or (self._screenshots == "only-on-failure" and reason == "failure")
        )
        if not wanted:
            return None
        try:
            shot = await with_deadline(
                self._driver.screenshot(), self._timeout, "trace screenshot"
            )
            return bytes(shot) if shot else None
        except Exception as error:
            self._bundle.drop(
                {
                    "reason": TraceDropReason.CAPTURE_FAILED,
                    "member": "screenshot",
                    "detail": error_message(error),
                }
            )
            return None

    async def checkpoint(
        self, name: str, actor: str | None = None, reason: str | None = None
    ) -> dict[str, Any]:
        async with self._capture_lock:
            return await self._checkpoint(name, actor, reason)

    async def _checkpoint(
        self,
        name: str,
        actor: str | None = None,
        reason: str | None = None,
    ) -> dict[str, Any]:
        """Capture a named checkpoint.

        Args:
            name: What this moment is
            actor: Who caused it (default ``automation``)
            reason: Why it was taken (default ``checkpoint``)

        Returns:
            ``{index, name, actor, reason, url, truncated, members}``

        Raises:
            RuntimeError: When the trace has already been stopped
        """
        if self.stopped:
            raise RuntimeError("this trace has already been stopped")
        actor = "automation" if actor is None else actor
        reason = TraceCheckpointReason.CHECKPOINT if reason is None else reason
        self._checkpoint_index += 1
        index = self._checkpoint_index

        # Mutations are drained first so the batches belong to the interval
        # that ended here, not to the one that starts now.
        await self._mutations.drain(index - 1 if index - 1 > 0 else 0)

        captured: Any = None
        try:
            captured = await with_deadline(
                self._driver.evaluate(
                    load_assets()["capture"]["captureSnapshot"],
                    {
                        "redactSelectors": self._privacy.redact_selectors,
                        "redactAttributes": self._privacy.redact_attributes,
                        "redacted": REDACTED,
                        "html": self._dom.get("html"),
                        "liveControlState": self._dom.get("liveControlState"),
                        "openShadowRoots": self._dom.get("openShadowRoots"),
                        "captureText": self._links_dom == "text",
                        "ignoreSelectors": self._dom.get(
                            "ignoreSelectors", self._dom.get("ignore_selectors", [])
                        ),
                        "maxHtmlBytes": coalesce(self._limits.get("maxHtmlBytes"), 0),
                    },
                ),
                self._timeout,
                "trace checkpoint capture",
            )
        except Exception as error:
            message = error_message(error)
            self._bundle.drop(
                {
                    "reason": TraceDropReason.PAGE_CLOSED
                    if "closed" in message.lower()
                    else TraceDropReason.CAPTURE_FAILED,
                    "member": f"checkpoints/{index}",
                    "detail": message,
                }
            )

        shot = await self._screenshot(reason)
        if not isinstance(captured, Mapping):
            captured = {}
        state = (
            redact_value(captured.get("state"), self._privacy)
            if js_truthy(captured.get("state"))
            else None
        )
        if not isinstance(state, Mapping):
            state = None

        members = self._bundle.write_checkpoint(
            index,
            html=captured.get("html"),
            state={**state, "name": name, "actor": actor, "reason": reason}
            if state is not None
            else None,
            screenshot=shot,
        )

        entry = {
            "index": index,
            "name": name,
            "actor": actor,
            "reason": reason,
            "url": redact_url(state.get("url", UNDEFINED), self._privacy)
            if state is not None
            else None,
            "truncated": js_truthy(captured.get("truncated")),
            "members": members,
        }
        self._checkpoints.append(entry)
        self.record(TraceEvent.CHECKPOINT, entry)

        # The init script covers every document created from here on; this
        # covers a frame attached without one, and installing over a recorder
        # that is already observing does nothing.
        await self._mutations.install()
        return entry

    async def stop(self, discard: bool = False, error: Any = None) -> dict[str, Any]:
        """Stop recording and write the manifest.

        Args:
            discard: Remove the bundle (and its export) instead of keeping it
            error: The failure that ended the run, recorded as a fatal error

        Returns:
            ``{path, manifest, checkpoints, problems, links}``, plus
            ``discarded`` when the bundle was removed
        """
        if self._stop_task is None:
            self._stop_task = asyncio.create_task(self._finish_stop(discard, error))
        return await asyncio.shield(self._stop_task)

    async def _finish_stop(self, discard: bool, error: Any) -> dict[str, Any]:
        try:
            return await self._finish_stop_inner(discard, error)
        except BaseException:
            await self._abort()
            raise

    async def _abort(self) -> None:
        self._stopping = True
        if self._periodic:
            self._periodic.cancel()
            await asyncio.gather(self._periodic, return_exceptions=True)
        with contextlib.suppress(Exception):
            await self._network.stop()
        if self._video:
            with contextlib.suppress(Exception):
                await self._video.stop()
        with contextlib.suppress(Exception):
            await self._mutations.stop()
        for detach in reversed(self._detachers):
            with contextlib.suppress(Exception):
                detached = detach()
                if hasattr(detached, "__await__"):
                    await detached
        self._detachers = []
        if self._links_sink:
            self._links_sink.discard()
        self._bundle.abort()

    async def _finish_stop_inner(self, discard: bool, error: Any) -> dict[str, Any]:
        if self._periodic:
            self._periodic.cancel()
            await asyncio.gather(self._periodic, return_exceptions=True)
        for detach in reversed(self._detachers):
            try:
                detached = detach()
                if hasattr(detached, "__await__"):
                    await detached
            except Exception as detach_error:
                self.note(f"could not detach a listener: {error_message(detach_error)}")
        self._detachers = []
        if self._navigation_tasks:
            await asyncio.gather(*self._navigation_tasks)
        await self._network.stop()
        if self._video:
            recording = await self._video.stop()
            self._bundle.write_member(
                "recording." + recording["format"], recording["bytes"]
            )
        await self._mutations.drain(self._checkpoint_index)
        if error is not None:
            self.record(
                TraceEvent.PAGE_ERROR,
                {
                    "message": error_message(error),
                    "stack": _error_stack(error),
                    "fatal": True,
                },
            )
        self.record(TraceEvent.TRACE_STOP, {"discarded": discard})
        self._stopping = True

        # The documents that exist stop observing here; the init script is
        # removed with the detachers below.
        await self._mutations.stop()

        for detach in reversed(self._detachers):
            try:
                detached = detach()
                if hasattr(detached, "__await__"):
                    await detached
            except Exception as detach_error:
                self.note(f"could not detach a listener: {error_message(detach_error)}")
        self._detachers = []

        mutations = js_truthy(self._dom.get("mutations"))
        manifest = self._bundle.close(
            create_manifest(
                mode=self.mode,
                started_at=self._started_at,
                stopped_at=iso_timestamp(self._now()),
                outcome=TraceOutcome.COMPLETE,
                commander_version=self._commander_version,
                engine=self._engine,
                dom=self._dom,
                events=self._events,
                replay={
                    "checkpoints": True,
                    "mutations": mutations,
                    "childListPositions": mutations,
                    "liveState": mutations and self._dom.get("liveState") is not False,
                    "identifiers": True,
                },
                privacy={
                    "redactSelectors": self._privacy.redact_selectors,
                    "redactAttributes": self._privacy.redact_attributes,
                    "redactQueryParams": self._privacy.redact_query_params,
                    "hasCallback": self._privacy.redact is not None,
                },
                limits=self._limits,
            )
        )

        # Closed after the manifest: the closing link reports the outcome the
        # manifest settled on, and the control diffs are read back out of the
        # finished bundle rather than kept in memory for a whole run.
        if self._links_sink is not None:
            self._links_sink.close(manifest, self._bundle.root)

        if (
            self._network_options
            and isinstance(self._network_options, Mapping)
            and self._network_options.get("har")
        ):
            target = self._network_options["har"]
            write_har(
                self._bundle.root,
                read_trace(self._bundle.root).events,
                target if isinstance(target, str) else None,
            )
        result: dict[str, Any] = {
            "path": self._bundle.root,
            "manifest": manifest,
            "checkpoints": list(self._checkpoints),
            "problems": [
                *self._bundle.problems,
                *(self._links_sink.problems if self._links_sink else []),
            ],
            "links": self.links,
        }
        self._stopped = result
        if self._limits.get("gzip"):
            from .storage import gzip_trace

            gzip_trace(self._bundle.root)

        if discard:
            shutil.rmtree(self._bundle.root, ignore_errors=True)
            # An export of a bundle that no longer exists points at nothing.
            if self._links_sink is not None:
                self._links_sink.discard()
            result["discarded"] = True

        return result


async def start_trace(
    commander: Any = None, page: Any = None, **options: Any
) -> TraceRecorder:
    """Start recording a session.

    Args:
        commander: The commander to record; its page, engine, log, dialog,
            download and navigation managers are used
        page: The page to record, when there is no commander
        **options: ``output`` (bundle directory, required), ``mode``
            (``checkpoints`` by default, or ``continuous``), ``events``,
            ``dom``, ``privacy``, ``limits``, ``screenshots``, ``strict``,
            ``links`` (``{"output": path, "include": [...]}``),
            ``initial_checkpoint``, ``capture_timeout_ms``,
            ``commander_version``, ``now``, ``monotonic`` and ``log``

    Returns:
        The running trace

    Raises:
        TypeError: For an unknown option
        ValueError: For an invalid mode, event source or output
    """
    if (options.get("limits") or {}).get("rotate"):
        from typing import cast

        from .rolling import start_rolling

        return cast(
            "TraceRecorder",
            await start_rolling(
                {**options, "commander": commander, "page": page}, start_trace
            ),
        )
    unknown = sorted(set(options) - _OPTIONS)
    if unknown:
        raise TypeError(f"unknown trace option(s): {', '.join(unknown)}")
    if page is None and commander is not None:
        page = getattr(commander, "page", None)
    if page is None:
        raise ValueError("startTrace requires a page or a commander")
    from browser_commander.browser.safari_webdriver import require_safari_feature

    require_safari_feature(page, "tracing")

    recorder = TraceRecorder(
        commander=commander,
        page=page,
        output=options.get("output"),
        mode=coalesce(options.get("mode"), TraceMode.CHECKPOINTS),
        initial_checkpoint=options.get("initial_checkpoint"),
        screenshots=options.get("screenshots", "checkpoints"),
        dom=options.get("dom") or {},
        events=options.get("events"),
        privacy=options.get("privacy") or {},
        limits=options.get("limits") or {},
        links=options.get("links"),
        network=options.get("network", False),
        video=options.get("video", False),
        strict=bool(options.get("strict", False)),
        capture_timeout_ms=options.get("capture_timeout_ms", DEFAULT_CAPTURE_TIMEOUT),
        commander_version=options.get("commander_version"),
        log=options.get("log", getattr(commander, "log", None)),
        now=options.get("now"),
        monotonic=options.get("monotonic"),
    )
    try:
        await recorder._start()
        if options.get("checkpoint_on_navigation"):

            def capture_navigation(*_args: Any) -> None:
                task = asyncio.create_task(
                    recorder.checkpoint(
                        "navigation", actor="recorder", reason="navigation"
                    )
                )
                recorder._navigation_tasks.add(task)
                task.add_done_callback(recorder._navigation_tasks.discard)

            page.on("load", capture_navigation)
            recorder._detachers.append(
                lambda: page.remove_listener("load", capture_navigation)
            )
    except BaseException:
        await recorder._abort()
        raise
    return recorder
