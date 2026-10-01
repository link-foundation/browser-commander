"""The observers behind a trace's shared timeline (issue #108).

A port of ``js/src/traces/observers.js``. Navigation, Browser Commander
interactions, console output, page errors, dialogs, failed requests and
downloads are reported by different objects in different engines. They all end
up as records on one ordered timeline, and this module is the only place that
knows how each of them is reached from Python:

- page events go through :meth:`EngineDriver.subscribe` (``page.on``), which
  Selenium does not have - its console, page error, failed request and frame
  navigation events are not recorded;
- navigation goes through the commander's ``NavigationManager`` when there is
  one, and through the engine's ``framenavigated`` event otherwise;
- dialogs go through ``DialogManager.observe_dialogs``, a passive hook that
  leaves the manager's auto-dismissal in place;
- downloads go through the commander's download manager (``downloads.on``);
- interactions are recorded by wrapping the commander's own methods, under the
  JavaScript method names so every language writes the same ``action``.
"""

from __future__ import annotations

import functools
import inspect
from collections.abc import Mapping
from typing import Any, Callable

from .engine import EngineDriver, error_message, read_first, read_property, settle
from .identity import TraceIdentity
from .schema import TraceEvent

#: Commander methods recorded as interactions, as the JavaScript names them.
TRACED_INTERACTIONS = (
    "click",
    "clickButton",
    "fill",
    "fillTextArea",
    "goto",
    "pressKey",
    "typeText",
    "setContent",
    "scrollIntoView",
)

#: Python commander methods recorded as interactions, and the JavaScript name
#: each is recorded under. ``keyboard_press`` is the Python spelling of
#: ``pressKey`` and ``keyboard_type`` of ``typeText``.
TRACED_METHODS = (
    ("click", "click"),
    ("click_button", "clickButton"),
    ("fill", "fill"),
    ("fill_text_area", "fillTextArea"),
    ("goto", "goto"),
    ("press_key", "pressKey"),
    ("keyboard_press", "pressKey"),
    ("type_text", "typeText"),
    ("keyboard_type", "typeText"),
    ("set_content", "setContent"),
    ("scroll_into_view", "scrollIntoView"),
)

_TARGET_KEYS = ("selector", "url", "locatorOrElement", "locator_or_element")

#: The navigation manager's events, by the phase they are recorded as.
_NAVIGATION_EVENTS = (
    ("start", "on_navigation_start"),
    ("complete", "on_navigation_complete"),
    ("urlchange", "on_url_change"),
)

#: Python navigation payload keys, by the name the JavaScript manager uses.
_NAVIGATION_KEYS = {
    "old_url": "previousUrl",
    "new_url": "newUrl",
    "session_id": "sessionId",
}

_DOWNLOAD_PHASES = ("started", "completed", "failed", "cancelled")


def interaction_target(argument: Any) -> str | None:
    """What an interaction was aimed at.

    A selector and a URL are the useful part of an interaction; typed text is
    never taken, because that is where passwords are.

    Args:
        argument: The interaction's first argument

    Returns:
        The selector or URL it acted on, or None
    """
    if isinstance(argument, str):
        return argument
    if not isinstance(argument, Mapping):
        return None
    for key in _TARGET_KEYS:
        value = argument.get(key)
        if isinstance(value, str):
            return value
    return None


def _call_target(method: Callable[..., Any], args: tuple, kwargs: dict) -> str | None:
    """Find the target of a Python call, whose arguments may be keywords.

    The JavaScript methods take a selector or an options object first; the
    Python ones take ``selector`` or ``url`` as a positional or keyword
    argument, and ``keyboard_press(key)`` takes the key, which - like typed
    text - is not a target.
    """
    try:
        parameters = list(inspect.signature(method).parameters.values())
        arguments = inspect.signature(method).bind(*args, **kwargs).arguments
    except (TypeError, ValueError):
        return interaction_target(args[0]) if args else None
    for key in _TARGET_KEYS:
        value = arguments.get(key)
        if isinstance(value, str):
            return value
    if args and (not parameters or parameters[0].kind == parameters[0].VAR_POSITIONAL):
        return interaction_target(args[0])
    if args and isinstance(args[0], Mapping):
        return interaction_target(args[0])
    return None


def _navigation_info(info: Any) -> dict[str, Any]:
    if not isinstance(info, Mapping):
        return {}
    converted: dict[str, Any] = {}
    for key, value in info.items():
        name = str(key)
        name = _NAVIGATION_KEYS.get(name, _camel(name))
        converted[name] = value
    return converted


def _camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in rest)


def _download_field(artifact: Any, camel: str, snake: str) -> Any:
    if isinstance(artifact, Mapping):
        value = artifact.get(camel)
        return artifact.get(snake) if value is None else value
    return read_first(artifact, camel, snake)


def attach_timeline_observers(
    *,
    commander: Any,
    driver: EngineDriver,
    event_sources: list[str],
    record: Callable[[str, dict[str, Any]], Any],
    note: Callable[[str], None],
    identity: TraceIdentity | None,
    now: Callable[[], float],
) -> list[Callable[[], Any]]:
    """Subscribe to everything a running trace listens to.

    Args:
        commander: The commander being traced, or None
        driver: The page being traced
        event_sources: Sources the caller asked for
        record: Writes one timeline record
        note: Reports an observer that could not attach
        identity: Trace identity; navigations move it on, interactions are
            named by it
        now: Wall clock in milliseconds, for durations

    Returns:
        One detach function per attached observer
    """
    detachers: list[Callable[[], Any]] = []

    def subscribe(source: str, attach: Callable[[], Any]) -> None:
        if source not in event_sources:
            return
        try:
            detach = attach()
            if callable(detach):
                detachers.append(detach)
        except Exception as error:
            note(f"could not observe {source}: {error_message(error)}")

    def passive(kind: str, build: Callable[[Any], dict[str, Any]]) -> Callable:
        # An engine calls this from its own event loop, and an exception here
        # would surface there; a record that could not be written is already
        # a drop in the bundle, so it is only noted.
        def listener(*payload: Any) -> None:
            try:
                record(kind, build(payload[0] if payload else None))
            except Exception as error:
                note(f"could not record {kind}: {error_message(error)}")

        return listener

    def on_page(event: str, build: Callable[[Any], dict[str, Any]], kind: str):
        return driver.subscribe(event, passive(kind, build))

    manager = getattr(commander, "navigation_manager", None) if commander else None

    def navigation() -> Any:
        if not manager:
            # Without the manager the engine's own event still gives ordering.
            def framenavigated(frame: Any) -> dict[str, Any]:
                is_main = True
                for name in ("parent_frame", "parentFrame"):
                    if hasattr(frame, name):
                        is_main = read_property(frame, name) is None
                        break
                # A record's navigation is the one it happened during, so the
                # counter moves on before the record of the move is written.
                if identity is None:
                    navigation_id = None
                elif is_main:
                    navigation_id = identity.navigated()
                else:
                    navigation_id = identity.navigation_id
                url = read_property(frame, "url")
                return {
                    "phase": "framenavigated",
                    "navigationId": navigation_id,
                    "mainFrame": is_main,
                    "url": url if url is not None else str(frame),
                }

            return on_page("framenavigated", framenavigated, TraceEvent.NAVIGATION)

        def phase_of(phase: str) -> Callable[[Any], dict[str, Any]]:
            def build(info: Any) -> dict[str, Any]:
                if phase == "complete":
                    # Everything after this belongs to the document that just
                    # loaded (issue #93).
                    navigated = identity.navigated() if identity else None
                    return {
                        "phase": phase,
                        "navigationId": navigated,
                        **_navigation_info(info),
                    }
                return {"phase": phase, **_navigation_info(info)}

            return build

        attached = []
        for phase, event in _NAVIGATION_EVENTS:
            listener = passive(TraceEvent.NAVIGATION, phase_of(phase))
            manager.on(event, listener)
            attached.append((event, listener))

        def detach() -> None:
            off = getattr(manager, "off", None)
            if callable(off):
                for event, listener in attached:
                    off(event, listener)

        return detach

    subscribe("navigation", navigation)

    def console(message: Any) -> dict[str, Any]:
        text = read_property(message, "text")
        return {
            "level": read_property(message, "type"),
            "text": text if text is not None else str(message),
        }

    subscribe("console", lambda: on_page("console", console, TraceEvent.CONSOLE))

    def pageerror(error: Any) -> dict[str, Any]:
        message = getattr(error, "message", None)
        if message is None and isinstance(error, Mapping):
            message = error.get("message")
        stack = getattr(error, "stack", None)
        if stack is None and isinstance(error, Mapping):
            stack = error.get("stack")
        return {
            "message": message if message is not None else str(error),
            "stack": stack,
        }

    subscribe(
        "pageerror", lambda: on_page("pageerror", pageerror, TraceEvent.PAGE_ERROR)
    )

    def requestfailed(request: Any) -> dict[str, Any]:
        failure = read_property(request, "failure")
        if isinstance(failure, Mapping):
            failure = failure.get("errorText", failure.get("error_text"))
        elif failure is not None and not isinstance(failure, str):
            failure = read_first(failure, "errorText", "error_text")
        return {
            "url": read_property(request, "url"),
            "method": read_property(request, "method"),
            "failure": failure,
        }

    subscribe(
        "requestfailed",
        lambda: on_page("requestfailed", requestfailed, TraceEvent.REQUEST_FAILED),
    )

    def dialog() -> Any:
        dialogs = getattr(commander, "dialog_manager", None) if commander else None
        observe = getattr(dialogs, "observe_dialogs", None)
        on_dialog = getattr(dialogs, "on_dialog", None)
        if not callable(observe) and not callable(on_dialog):
            return None

        listener = passive(
            TraceEvent.DIALOG,
            lambda shown: {
                "type": read_property(shown, "type"),
                "message": read_property(shown, "message"),
            },
        )
        # Recording a dialog must not decide what happens to it: a passive
        # observer leaves the manager's auto-dismissal in place, so a traced
        # run answers dialogs exactly the way the same untraced run would.
        if callable(observe):
            observe(listener)
            unobserve = getattr(dialogs, "unobserve_dialogs", None)
            return (lambda: unobserve(listener)) if callable(unobserve) else None
        on_dialog(listener)
        off_dialog = getattr(dialogs, "off_dialog", None)
        return (lambda: off_dialog(listener)) if callable(off_dialog) else None

    subscribe("dialog", dialog)

    def download() -> Any:
        downloads = getattr(commander, "downloads", None) if commander else None
        on = getattr(downloads, "on", None)
        if not callable(on):
            return None

        def build(phase: str) -> Callable[[Any], dict[str, Any]]:
            def fields(artifact: Any) -> dict[str, Any]:
                # The path and checksum are the reference; the bytes stay
                # where the download manager put them.
                return {
                    "phase": phase,
                    "id": _download_field(artifact, "id", "id"),
                    "suggestedFilename": _download_field(
                        artifact, "suggestedFilename", "suggested_filename"
                    ),
                    "path": _download_field(artifact, "path", "path"),
                    "checksum": _download_field(artifact, "checksum", "checksum"),
                    "bytes": _download_field(artifact, "bytes", "bytes"),
                    "url": _download_field(artifact, "url", "url"),
                    "failure": _download_field(artifact, "failure", "failure"),
                }

            return fields

        listeners = []
        for phase in _DOWNLOAD_PHASES:
            listener = passive(TraceEvent.DOWNLOAD, build(phase))
            on(phase, listener)
            listeners.append((phase, listener))

        def detach() -> None:
            off = getattr(downloads, "off", None)
            if callable(off):
                for phase, listener in listeners:
                    off(phase, listener)

        return detach

    subscribe("download", download)

    def interaction() -> Any:
        if not commander:
            return None
        originals: list[tuple[str, bool, Any]] = []
        for python_name, action in TRACED_METHODS:
            original = getattr(commander, python_name, None)
            if not callable(original):
                continue
            own = python_name in getattr(commander, "__dict__", {})
            originals.append((python_name, own, original))
            setattr(commander, python_name, _traced(original, action))

        def detach() -> None:
            for python_name, own, original in reversed(originals):
                if own:
                    setattr(commander, python_name, original)
                else:
                    try:
                        delattr(commander, python_name)
                    except AttributeError:
                        setattr(commander, python_name, original)

        return detach

    def _traced(original: Callable[..., Any], action: str) -> Callable[..., Any]:
        @functools.wraps(original)
        async def traced(*args: Any, **kwargs: Any) -> Any:
            started = now()
            target = _call_target(original, args, kwargs)
            # Named before the call, so everything the action causes can be
            # traced back to it even when the action ends in an exception.
            action_id = identity.next_action_id() if identity else None
            try:
                result = await settle(original(*args, **kwargs))
            except Exception as error:
                record(
                    TraceEvent.INTERACTION,
                    {
                        "actionId": action_id,
                        "action": action,
                        "target": target,
                        "durationMs": now() - started,
                        "ok": False,
                        "error": error_message(error),
                    },
                )
                raise
            record(
                TraceEvent.INTERACTION,
                {
                    "actionId": action_id,
                    "action": action,
                    "target": target,
                    "durationMs": now() - started,
                    "ok": True,
                },
            )
            return result

        return traced

    subscribe("interaction", interaction)
    return detachers
