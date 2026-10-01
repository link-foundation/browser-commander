"""Test doubles for recording traces without a browser (issue #108).

The conformance scenario is the one ``scripts/generate-trace-conformance.mjs``
replays against JavaScript; the doubles here answer the Python recorder the
way that script's doubles answer the JavaScript one, in the shapes Python's
Playwright uses (properties rather than getter methods).
"""

from __future__ import annotations

import asyncio
import contextlib
import copy
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable

from browser_commander.traces.identity import _reset_identity_counters
from browser_commander.traces.recorder import start_trace
from browser_commander.traces.viewer import write_trace_viewer

REPO_ROOT = Path(__file__).resolve().parents[3]
CONFORMANCE_DIR = REPO_ROOT / "js" / "tests" / "fixtures" / "traces" / "conformance"
EXPECTED_DIR = CONFORMANCE_DIR / "expected"

#: The scenario's camelCase actions, as the Python commander spells them.
SCENARIO_ACTIONS = {"goto": "goto", "clickButton": "click_button"}


#: Listener tasks still running, kept so they are not collected mid-flight.
_TASKS: set[asyncio.Future[Any]] = set()


class Emitter:
    """A minimal ``page.on`` / ``remove_listener`` event emitter."""

    def __init__(self) -> None:
        self.listeners: dict[str, list[Callable[..., Any]]] = defaultdict(list)

    def on(self, event: str, listener: Callable[..., Any]) -> None:
        self.listeners[event].append(listener)

    def remove_listener(self, event: str, listener: Callable[..., Any]) -> None:
        if listener in self.listeners[event]:
            self.listeners[event].remove(listener)

    def emit(self, event: str, *args: Any) -> None:
        for listener in list(self.listeners[event]):
            result = listener(*args)
            # Playwright runs a coroutine listener as a task of its own.
            if asyncio.iscoroutine(result):
                _TASKS.add(task := asyncio.ensure_future(result))
                task.add_done_callback(_TASKS.discard)

    def count(self) -> int:
        return sum(len(listeners) for listeners in self.listeners.values())


class Payload:
    """An engine event payload whose fields are properties, as in Playwright."""

    def __init__(self, **fields: Any) -> None:
        self.__dict__.update(fields)


def make_snapshot(**overrides: Any) -> dict[str, Any]:
    """A snapshot shaped like the one the in-page capture returns."""
    state = {
        "url": "https://example.com/report",
        "title": "Report",
        "readyState": "complete",
        "scroll": {"x": 0, "y": 0},
        "viewport": {"width": 1280, "height": 720},
        "activeElement": None,
        "controls": [
            {"path": "form > input", "tag": "input", "type": "text", "value": "alice"}
        ],
        "frames": [],
        **overrides.pop("state", {}),
    }
    return {
        "html": "<!DOCTYPE html>\n<html><body><p>captured</p></body></html>",
        "truncated": False,
        **overrides,
        "state": state,
    }


def _function_name(source: str) -> str:
    return source.split("(", 1)[0].replace("function", "").strip()


class FakeFrame:
    """A child frame of a :class:`FakePage`, with its own mutation queue."""

    def __init__(
        self, page: FakePage, frame_id: str, mutations: list[dict[str, Any]]
    ) -> None:
        self.page = page
        self.frame_id = frame_id
        self.mutations = list(mutations)

    async def evaluate(self, source: str, arg: Any = None) -> Any:
        name = _function_name(source)
        self.page.evaluated.append((name, arg))
        if name == "drainMutationsInPage":
            batches, self.mutations = self.mutations, []
            return {
                "batches": [
                    {"frameId": self.frame_id, "mainFrame": False, **batch}
                    for batch in batches
                ],
                "dropped": 0,
                "installed": True,
                "frameId": self.frame_id,
                "mainFrame": False,
            }
        return True


class FakePage:
    """A page that answers the recorder the way a test says.

    ``frames`` is only an attribute of a page given child frames, the way a
    page object from neither engine has none.
    """

    def __init__(
        self,
        snapshot: Any = None,
        *,
        mutations: list[dict[str, Any]] | None = None,
        dropped: int = 0,
        frames: list[list[dict[str, Any]]] | None = None,
    ) -> None:
        self.emitter = Emitter()
        self.snapshot = snapshot
        self.mutations: list[dict[str, Any]] = list(mutations or [])
        self.dropped = dropped
        self.context = object()
        self.init_scripts: list[str] = []
        self.evaluated: list[tuple[str, Any]] = []
        self.failures: dict[str, BaseException] = {}
        self.capture_error: BaseException | None = None
        self.screenshot_bytes = b"fake-png"
        self.screenshots = 0
        self.hang = False
        if frames is not None:
            self.frames = [
                self,
                *(
                    FakeFrame(self, f"child-{index + 1}", queued)
                    for index, queued in enumerate(frames)
                ),
            ]

    def calls(self, name: str) -> list[Any]:
        """The arguments of every evaluation of one in-page function."""
        return [arg for called, arg in self.evaluated if called == name]

    async def evaluate(self, source: str, arg: Any = None) -> Any:
        name = _function_name(source)
        self.evaluated.append((name, arg))
        if self.hang:
            await asyncio.Event().wait()
        if name in self.failures:
            raise self.failures[name]
        if name == "captureSnapshotInPage":
            if self.capture_error is not None:
                raise self.capture_error
            return copy.deepcopy(self.snapshot)
        if name == "drainMutationsInPage":
            batches, self.mutations = self.mutations, []
            dropped, self.dropped = self.dropped, 0
            return {
                "batches": [
                    {"frameId": "main", "mainFrame": True, **batch} for batch in batches
                ],
                "dropped": dropped,
                "installed": True,
                "frameId": "main",
                "mainFrame": True,
            }
        return True

    async def screenshot(self, **_options: Any) -> bytes:
        self.screenshots += 1
        return self.screenshot_bytes

    async def add_init_script(self, script: str | None = None, **_: Any) -> None:
        self.init_scripts.append(script or "")

    def on(self, event: str, listener: Callable[..., Any]) -> None:
        self.emitter.on(event, listener)

    def remove_listener(self, event: str, listener: Callable[..., Any]) -> None:
        self.emitter.remove_listener(event, listener)

    def emit(self, event: str, payload: Any = None) -> None:
        """Emit an engine event, as Playwright would."""
        self.emitter.emit(event, payload)


class FakeDialogManager:
    """The JavaScript double's dialog manager: handlers only, no observers."""

    def __init__(self) -> None:
        self.handlers: list[Callable[..., Any]] = []

    def on_dialog(self, handler: Callable[..., Any]) -> None:
        self.handlers.append(handler)

    def off_dialog(self, handler: Callable[..., Any]) -> None:
        self.handlers.remove(handler)


class FakeDownloads:
    """A download manager with ``on`` and ``off``."""

    def __init__(self) -> None:
        self.emitter = Emitter()

    def on(self, event: str, listener: Callable[..., Any]) -> None:
        self.emitter.on(event, listener)

    def off(self, event: str, listener: Callable[..., Any]) -> None:
        self.emitter.remove_listener(event, listener)


class FakeCommander:
    """A commander with the parts the recorder reaches for."""

    def __init__(self, page: FakePage, engine: str = "playwright") -> None:
        self.page = page
        self.engine = engine
        self.log = None
        self.dialog_manager = FakeDialogManager()
        self.downloads = FakeDownloads()
        self.fail_next: str | None = None

    def _settle(self) -> bool:
        message, self.fail_next = self.fail_next, None
        if message:
            raise RuntimeError(message)
        return True

    async def goto(self, url: str) -> bool:
        return self._settle()

    async def click_button(self, selector: str) -> bool:
        return self._settle()


class ObservingDialogManager:
    """A dialog manager's observation surface, without a browser.

    :meth:`raise_dialog` plays the manager's own rule back: observers are
    told, and a dialog nobody answered is dismissed rather than left blocking
    the page.
    """

    def __init__(self) -> None:
        self.observers: list[Callable[..., Any]] = []

    def observe_dialogs(self, observer: Callable[..., Any]) -> Callable[[], None]:
        self.observers.append(observer)
        return lambda: self.unobserve_dialogs(observer)

    def unobserve_dialogs(self, observer: Callable[..., Any]) -> None:
        if observer in self.observers:
            self.observers.remove(observer)

    async def raise_dialog(self, type: str, message: str) -> Payload:
        dialog = Payload(type=type, message=message, dismissed=False)

        async def dismiss() -> None:
            dialog.dismissed = True

        dialog.dismiss = dismiss
        for observer in list(self.observers):
            await _maybe_await(observer(dialog))
        if not dialog.dismissed:
            await dialog.dismiss()
        return dialog


class ActionCommander:
    """A commander with the interactions the recorder wraps.

    Keyword arguments become attributes, so a test can give it a download
    manager, a dialog manager or a ``click`` of its own.
    """

    def __init__(self, page: FakePage, **extras: Any) -> None:
        self.page = page
        self.engine = "playwright"
        self.log = None
        for name, value in extras.items():
            setattr(self, name, value)

    async def click(self, selector: Any) -> Any:
        return {"clicked": selector}

    async def goto(self, url: Any) -> Any:
        return {"url": url}

    async def type_text(self, selector: str, text: str) -> Any:
        return {"selector": selector, "text": text}

    async def keyboard_press(self, key: str) -> None:
        return None


def engine_event(event: str, data: dict[str, Any]) -> Payload:
    """The Python Playwright shape of one scenario event."""
    if event == "framenavigated":
        return Payload(
            parent_frame=None if data["main"] else Payload(), url=data["url"]
        )
    if event == "console":
        return Payload(type=data["type"], text=data["text"])
    if event == "pageerror":
        return Payload(message=data["message"], stack=data["stack"])
    if event == "requestfailed":
        return Payload(
            url=data["url"], method=data["method"], failure=data["errorText"]
        )
    raise ValueError(f"unknown scenario event {event}")


def read_scenario() -> dict[str, Any]:
    """The scenario every language replays."""
    return json.loads((CONFORMANCE_DIR / "scenario.json").read_text(encoding="utf-8"))


async def record_conformance_scenario(
    scenario: dict[str, Any], output: Path
) -> dict[str, Any]:
    """Record the scenario into ``output`` (``bundle/`` and ``trace.lino``).

    Args:
        scenario: The parsed scenario
        output: Directory to write into

    Returns:
        What ``stop()`` returned
    """
    _reset_identity_counters()
    page = FakePage(scenario["snapshot"])
    commander = FakeCommander(page, scenario["engine"])
    options = scenario["options"]
    clock = scenario["clock"]
    trace = await start_trace(
        commander,
        output=str(output / "bundle"),
        mode=options["mode"],
        commander_version=options["commanderVersion"],
        privacy=options["privacy"],
        limits=options["limits"],
        links={"output": str(output / "trace.lino")} if options["links"] else None,
        now=lambda: clock["now"],
        monotonic=lambda: clock["monotonic"],
    )

    result: dict[str, Any] = {}
    for step in scenario["steps"]:
        op = step["op"]
        if op == "queueMutations":
            page.mutations.extend(step["batches"])
            page.dropped += step.get("dropped", 0)
        elif op == "setSnapshot":
            page.snapshot = step["snapshot"]
        elif op == "emit":
            page.emitter.emit(step["event"], engine_event(step["event"], step["data"]))
        elif op == "dialog":
            dialog = Payload(type=step["data"]["type"], message=step["data"]["message"])
            for handler in list(commander.dialog_manager.handlers):
                await _maybe_await(handler(dialog))
        elif op == "download":
            commander.downloads.emitter.emit(step["phase"], step["artifact"])
        elif op == "interaction":
            commander.fail_next = step.get("fail")
            action = getattr(commander, SCENARIO_ACTIONS[step["action"]])
            # A failing action is what the trace records, not a test failure.
            with contextlib.suppress(Exception):
                await action(step["target"])
        elif op == "checkpoint":
            await trace.checkpoint(
                step["name"], actor=step.get("actor"), reason=step.get("reason")
            )
        elif op == "event":
            await trace.event(step["name"], step["data"])
        elif op == "stop":
            result = await trace.stop()
        else:
            raise ValueError(f"unknown conformance step {op}")
    write_trace_viewer(output / "bundle")
    return result


async def _maybe_await(value: Any) -> Any:
    if hasattr(value, "__await__"):
        return await value
    return value


def read_tree(directory: Path) -> dict[str, bytes]:
    """Every file under a directory, by POSIX relative path."""
    return {
        path.relative_to(directory).as_posix(): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def normalize_machine(
    files: dict[str, bytes], machine: dict[str, Any]
) -> dict[str, bytes]:
    """Rewrite what a manifest says about the machine, wherever it appears."""
    normalized = {}
    for name, data in files.items():
        if not name.endswith((".json", ".html")):
            normalized[name] = data
            continue
        text = data.decode("utf-8")
        for key in ("platform", "runtime"):
            value = json.dumps(machine[key], ensure_ascii=False)
            neutral = json.dumps("conformance")
            for separator in (": ", ":"):
                text = text.replace(
                    f'"{key}"{separator}{value}', f'"{key}"{separator}{neutral}'
                )
        normalized[name] = text.encode("utf-8")
    return normalized


_REF = r"""(?:'[^']*'|"[^"]*"|[^\s():'"]+)"""
_FIELD = rf"\(({_REF}): ({_REF}(?: {_REF})*)\)"
_LINK_LINE = re.compile(rf"\(({_REF}):((?: {_FIELD})*)\)")
_LINK_FIELD = re.compile(_FIELD)
_LINK_REF = re.compile(_REF)


def _reference(token: str) -> str:
    return token[1:-1] if token[0] in "'\"" else token


def parse_links_export(text: str) -> list[dict[str, Any]]:
    """Read an export back, one ``{"id": ..., "fields": {...}}`` per line.

    A small reader for the subset of Links Notation the export writes: every
    line is ``(id: (name: value) ...)`` and a value is one reference or a
    sequence of them (read back as a list), quoted when it has to be (never with both quote characters inside). Each value is
    decoded the way a consumer of the export would.
    """
    from browser_commander.traces import decode_link_text

    parsed = []
    for line in text.split("\n"):
        if not line:
            continue
        match = _LINK_LINE.fullmatch(line)
        if match is None:
            raise ValueError(f"not a link the export writes: {line}")
        fields = {}
        for name, value in _LINK_FIELD.findall(match.group(2)):
            references = [
                decode_link_text(_reference(token))
                for token in _LINK_REF.findall(value)
            ]
            fields[_reference(name)] = (
                references[0] if len(references) == 1 else references
            )
        parsed.append({"id": _reference(match.group(1)), "fields": fields})
    return parsed
