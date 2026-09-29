"""Measure how far a driven browser is from the same browser started by hand.

This is issue #103. Three things are compared, because each can give
automation away on its own:

- the command line, as the browser itself reports it on chrome://version,
  against the one a person would type (``--user-data-dir`` and, headless,
  ``--headless=new``);
- the feature state the command line sets (``--enable-features``,
  ``--disable-features``, ``--disable-blink-features``, ...);
- everything a page can read, through the environment probe that also backs
  the parity e2e suite.

Every difference is either explained by an entry in the shared limitations
catalogue, explained by an option the caller asked for, or unlisted. A report
with unlisted differences is not ``ok``.

The report is byte-compatible with the JavaScript one, so its keys are
camelCase (``executablePath``, ``commandLine``).
"""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import re
import uuid
from collections.abc import Mapping, Sequence
from typing import Any, Callable

from browser_commander.fingerprint.limitations import find_fingerprint_limitation
from browser_commander.parity.harness import (
    capture_reference_report,
    diff_reports,
    read_probe_source,
    start_probe_server,
)
from browser_commander.parity.version_page import read_reference_version_page

__all__ = [
    "classify_differences",
    "compare_command_lines",
    "explain_difference",
    "measure_parity",
    "parse_switches",
    "read_browser_version_page",
]

#: Switches whose value differs on every launch by construction. Their
#: presence is compared; their value is not.
_VOLATILE_SWITCHES = frozenset({"--user-data-dir"})

#: Markers Chrome itself writes around the switches it took from
#: chrome://flags. A hand-started browser shows them too.
_CHROME_MARKERS = frozenset({"--flag-switches-begin", "--flag-switches-end"})

#: Switches that carry a comma-separated feature list.
_FEATURE_SWITCHES = frozenset(
    {
        "--enable-features",
        "--disable-features",
        "--enable-blink-features",
        "--disable-blink-features",
    }
)

#: The debugging port is how the library attaches. Issue #101 measured that a
#: fixed non-zero port changes nothing a page can observe, so it is reported
#: as the attachment rather than as a difference.
_ATTACHMENT_SWITCHES = frozenset({"--remote-debugging-port"})

_URL_WORD = re.compile(r"^[a-z][a-z0-9+.\-]*:", re.IGNORECASE)

# Switches that change which Blink features and field trials are active. A
# non-Chrome-branded build (Chromium) applies its testing field-trial config
# unless told otherwise, so Playwright's --disable-field-trial-config alone
# changes the API surface (the Protected Audience methods on navigator) and
# the language list on Chromium, while Chrome and Edge are unaffected.
_FEATURE_CONFIG_SWITCHES = frozenset(
    {"--disable-field-trial-config", "--disable-features", "--enable-features"}
)

# Surfaces those switches are measured to move: which properties an object
# exposes, and the reduced or full Accept-Language list.
_FEATURE_CONFIG_SURFACES = re.compile(r"(?:^|\.)(?:keys|languages)\Z")

_READ_VERSION_TEXT = """() => {
  const text = (id) => (document.getElementById(id)?.textContent ?? '').trim();
  return {
    commandLine: text('command_line'),
    version: text('version'),
    executablePath: text('executable_path'),
  };
}"""


def _join_switch_words(words: list[str]) -> list[str]:
    """Regroup whitespace-separated words into switches.

    A word starting with ``--`` starts a switch; any other word continues the
    previous one's value. The start URL, when there is one, is the last word
    and is dropped.
    """

    last = words[-1] if words else ""
    if len(words) > 1 and not last.startswith("--") and _URL_WORD.match(last):
        words = words[:-1]
    tokens: list[str] = []
    for word in words:
        if word.startswith("--") or not tokens:
            tokens.append(word)
        else:
            tokens[-1] += f" {word}"
    return tokens


def parse_switches(command_line: str | Sequence[str]) -> dict[str, str | None]:
    """Split a command line into ``--switch[=value]`` entries.

    chrome://version prints the command line joined with spaces, so a value
    containing a space (a profile path, say) cannot be recovered exactly.
    Every ``--`` that follows whitespace starts a new switch; the executable
    and any trailing URL are not switches and are dropped.

    Returns:
        Switch name to value (``None`` for a flag), in command-line order.
    """

    if isinstance(command_line, str):
        tokens = _join_switch_words(command_line.split())
    else:
        tokens = [str(token) for token in command_line]
    switches: dict[str, str | None] = {}
    for token in tokens:
        if not token.startswith("--"):
            continue
        name, separator, value = token.partition("=")
        switches[name] = value if separator else None
    return switches


def _feature_list(value: str | None) -> list[str]:
    return sorted(entry.strip() for entry in (value or "").split(",") if entry.strip())


def compare_command_lines(
    reference: str | Sequence[str], candidate: str | Sequence[str]
) -> dict[str, Any]:
    """Compare the command line the browser reports with the reference one.

    Returns:
        ``{"extra", "missing", "changed", "attachment", "features"}``.
    """

    left = parse_switches(reference)
    right = parse_switches(candidate)
    extra: list[str] = []
    missing: list[str] = []
    changed: list[dict[str, Any]] = []
    attachment: list[str] = []
    features: dict[str, dict[str, list[str]]] = {}
    for name in sorted({*left, *right}):
        if name in _CHROME_MARKERS:
            continue
        if name in _ATTACHMENT_SWITCHES:
            if name in right:
                attachment.append(f"{name}={_js_string(right[name])}")
            continue

        def formatted(switches: Mapping[str, str | None], key: str = name) -> str:
            value = switches.get(key)
            return key if value is None else f"{key}={value}"

        if name not in left:
            extra.append(formatted(right))
        elif name not in right:
            missing.append(formatted(left))
        elif name not in _VOLATILE_SWITCHES and left[name] != right[name]:
            changed.append(
                {"name": name, "reference": left[name], "candidate": right[name]}
            )
        if name in _FEATURE_SWITCHES:
            features[name] = {
                "reference": _feature_list(left.get(name)),
                "candidate": _feature_list(right.get(name)),
            }
    return {
        "extra": extra,
        "missing": missing,
        "changed": changed,
        "attachment": attachment,
        "features": features,
    }


def _js_string(value: Any) -> str:
    return "null" if value is None else str(value)


def _command_line_differences(comparison: Mapping[str, Any]) -> list[dict[str, Any]]:
    return [
        *(
            {
                "path": f"commandLine.extra.{entry.split('=')[0]}",
                "reference": None,
                "candidate": entry,
            }
            for entry in comparison["extra"]
        ),
        *(
            {
                "path": f"commandLine.missing.{entry.split('=')[0]}",
                "reference": entry,
                "candidate": None,
            }
            for entry in comparison["missing"]
        ),
        *(
            {
                "path": f"commandLine.changed.{change['name']}",
                "reference": change["reference"],
                "candidate": change["candidate"],
            }
            for change in comparison["changed"]
        ),
    ]


def _changes_feature_config(extra_switches: Sequence[str] | None) -> bool:
    return any(
        str(entry).split("=")[0] in _FEATURE_CONFIG_SWITCHES
        for entry in extra_switches or ()
    )


def _context_value(context: Mapping[str, Any], key: str, js_key: str) -> Any:
    return context.get(key, context.get(js_key))


def explain_difference(
    difference: Mapping[str, Any], context: Mapping[str, Any]
) -> dict[str, Any]:
    """Explain a difference.

    Args:
        difference: ``{"path", "reference", "candidate"}``.
        context: ``{"launch", "attached", "extra_switches", "requested_args"}``.

    Returns:
        ``{"limitation": id}``, ``{"requested": True}`` for a switch the caller
        asked for (or that follows from an option they set), or ``{}``.
    """

    path = str(difference["path"])
    launch = context.get("launch")
    if path.startswith("commandLine."):
        value = difference.get("candidate")
        if value is None:
            value = difference.get("reference")
        text = "" if value is None else str(value)
        requested = _context_value(context, "requested_args", "requestedArgs") or ()
        if any(arg == text for arg in requested):
            return {"requested": True}
        if launch == "engine":
            return {"limitation": "engine-launch-switches"}
        return {}
    if (
        launch == "engine"
        and _FEATURE_CONFIG_SURFACES.search(path)
        and _changes_feature_config(
            _context_value(context, "extra_switches", "extraSwitches")
        )
    ):
        return {"limitation": "engine-launch-switches"}
    if path.startswith("navigator.userAgentData.brands"):
        return {"limitation": "grease-brand-not-reproduced"}
    if path == "navigator.webdriver" and context.get("attached"):
        return {"limitation": "automation-controlled-is-launch-only"}
    return {}


def classify_differences(
    differences: Sequence[Mapping[str, Any]], context: Mapping[str, Any]
) -> dict[str, list[dict[str, Any]]]:
    """Tag every difference with its explanation and split out the unlisted.

    Returns:
        ``{"differences": [...], "unlisted": [...]}`` where each entry is
        ``{"path", "expected", "actual", "limitation", "requested"}``.
    """

    tagged: list[dict[str, Any]] = []
    for difference in differences:
        explanation = explain_difference(difference, context)
        limitation_id = explanation.get("limitation")
        limitation = (
            limitation_id
            if limitation_id and find_fingerprint_limitation(limitation_id)
            else None
        )
        tagged.append(
            {
                "path": difference["path"],
                "expected": difference.get("reference"),
                "actual": difference.get("candidate"),
                "limitation": limitation,
                "requested": explanation.get("requested") is True,
            }
        )
    return {
        "differences": tagged,
        "unlisted": [
            entry
            for entry in tagged
            if not entry["limitation"] and not entry["requested"]
        ],
    }


async def _maybe_await(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


def _read_selenium_version_page(driver: Any) -> dict[str, str]:
    original = driver.current_window_handle
    driver.switch_to.new_window("tab")
    try:
        driver.get("chrome://version")
        return driver.execute_script(f"return ({_READ_VERSION_TEXT})();")
    finally:
        with contextlib.suppress(Exception):
            driver.close()
        with contextlib.suppress(Exception):
            driver.switch_to.window(original)


async def read_browser_version_page(page: Any) -> dict[str, str]:
    """Read the browser's own view of itself from chrome://version.

    The page is read in a new tab, so the page under measurement is left
    where it was.

    Args:
        page: A Playwright page (``page.context``), a Puppeteer-style page
            (``page.browser()``) or a Selenium driver.

    Returns:
        ``{"commandLine", "version", "executablePath"}``.
    """

    if hasattr(page, "switch_to") and hasattr(page, "execute_script"):
        return await asyncio.to_thread(_read_selenium_version_page, page)
    context = getattr(page, "context", None)
    opener = context() if callable(context) else context
    if opener is None:
        opener = await _maybe_await(page.browser())
    version_page = await _maybe_await(opener.new_page())
    try:
        await _maybe_await(version_page.goto("chrome://version"))
        return await _maybe_await(version_page.evaluate(_READ_VERSION_TEXT))
    finally:
        with contextlib.suppress(Exception):
            await _maybe_await(version_page.close())


def _field(session: Any, name: str, default: Any = None) -> Any:
    if isinstance(session, Mapping):
        return session.get(name, default)
    return getattr(session, name, default)


async def _navigate(page: Any, url: str) -> None:
    if hasattr(page, "switch_to") and hasattr(page, "get"):
        await asyncio.to_thread(page.get, url)
        return
    await _maybe_await(page.goto(url, wait_until="load"))


async def _capture_candidate(
    session: Any, server: Any, read_version_page: Callable[..., Any]
) -> dict[str, Any]:
    token = str(uuid.uuid4())
    page = _field(session, "page")
    await _navigate(page, server.url(token))
    report = await _maybe_await(server.wait_for_report(token))
    version_page = await _maybe_await(read_version_page(page))
    return {"report": report, "version_page": version_page}


async def _close_session(session: Any) -> None:
    close = _field(session, "close")
    if callable(close):
        await _maybe_await(close())
        return
    browser = _field(session, "browser")
    for method in ("close", "quit"):
        handler = getattr(browser, method, None)
        if callable(handler):
            await _maybe_await(handler())
            return


def _normalize_whitespace(text: Any) -> str:
    return " ".join(str(text or "").split())


def _requested_args_for(session: Any, options: Mapping[str, Any]) -> list[str]:
    requested = [*(options.get("args") or []), *(options.get("extra_args") or [])]
    launched_args = _field(session, "args") or []
    if options.get("restrictions"):
        requested.extend(
            arg
            for arg in launched_args
            if not arg.startswith("--user-data-dir")
            and not arg.startswith("--remote-debugging-port")
        )
    return requested


async def _default_launch_browser(options: Mapping[str, Any]) -> Any:
    from browser_commander.browser.launcher import LaunchOptions, launch_browser

    return await launch_browser(LaunchOptions(**options))


async def _default_resolve_launch_executable(**kwargs: Any) -> Any:
    from browser_commander.browser.launcher import resolve_launch_executable

    return await resolve_launch_executable(**kwargs)


async def measure_parity(
    options: Mapping[str, Any] | None = None,
    dependencies: Mapping[str, Any] | None = None,
    **option_kwargs: Any,
) -> dict[str, Any]:
    """Measure a browser against the same binary started by hand.

    Args:
        options: Launch options for :func:`launch_browser` as snake_case keys
            (``engine``, ``channel``, ``executable_path``, ``headless``,
            ``launch``, ``restrictions``, ``args``, ...) plus:

            - ``session``: measure this already-launched session (the result
              of ``launch_browser``/``launch_real_browser``) instead of
              launching;
            - ``attached``: the session was started by somebody else and only
              connected to.
        dependencies: Test seams: ``launch_browser``,
            ``resolve_launch_executable``, ``start_server``, ``read_probe``,
            ``capture_reference``, ``read_version_page``,
            ``read_reference_version``.
        **option_kwargs: Merged over ``options``.

    Returns:
        The parity report described in ``docs/cli-and-bridge.md``.
    """

    merged: dict[str, Any] = {**(options or {}), **option_kwargs}
    provided_session = merged.pop("session", None)
    attached = bool(merged.pop("attached", False))
    headless = bool(merged.pop("headless", False))
    launch_options = merged
    deps = dependencies or {}
    launch_browser = deps.get("launch_browser", _default_launch_browser)
    resolve_launch_executable = deps.get(
        "resolve_launch_executable", _default_resolve_launch_executable
    )
    start_server = deps.get("start_server", start_probe_server)
    read_probe = deps.get("read_probe", read_probe_source)
    capture_reference = deps.get("capture_reference", capture_reference_report)
    read_version_page = deps.get("read_version_page", read_browser_version_page)
    read_reference_version = deps.get(
        "read_reference_version", read_reference_version_page
    )

    engine = launch_options.get("engine") or "playwright"
    executable_path = _field(provided_session, "executable_path")
    if executable_path is None:
        executable_path = await _maybe_await(
            resolve_launch_executable(
                engine=engine,
                channel=launch_options.get("channel"),
                executable_path=launch_options.get("executable_path"),
            )
        )
    server = await _maybe_await(start_server(await _maybe_await(read_probe())))
    try:
        reference = await _maybe_await(
            capture_reference(
                executable_path=executable_path,
                server=server,
                token=str(uuid.uuid4()),
                headless=headless,
            )
        )
        # The browser appends switches of its own (--ozone-platform=..., and
        # several more headless), so the reference command line is what the
        # same binary reports for the argv a person types, not that argv.
        reference_version_page = await _maybe_await(
            read_reference_version(executable_path=executable_path, headless=headless)
        )
        session = provided_session
        if session is None:
            session = await _maybe_await(
                launch_browser(
                    {
                        **launch_options,
                        "engine": engine,
                        "executable_path": executable_path,
                        "headless": headless,
                    }
                )
            )
        try:
            candidate = await _capture_candidate(session, server, read_version_page)
        finally:
            if provided_session is None:
                await _close_session(session)
        launch = _field(session, "launch") or launch_options.get("launch") or "real"
        command_line = compare_command_lines(
            reference_version_page["commandLine"],
            candidate["version_page"]["commandLine"],
        )
        classified = classify_differences(
            [
                *_command_line_differences(command_line),
                *diff_reports(reference, candidate["report"]),
            ],
            {
                "launch": launch,
                "attached": attached,
                "extra_switches": command_line["extra"],
                "requested_args": _requested_args_for(
                    session, {**launch_options, "headless": headless}
                ),
            },
        )
        return {
            "browser": {
                "executablePath": executable_path,
                "version": _normalize_whitespace(
                    candidate["version_page"].get("version")
                ),
                "engine": engine,
                "launch": launch,
                "headless": headless,
            },
            "commandLine": {
                "launched": candidate["version_page"]["commandLine"],
                "reference": reference_version_page["commandLine"],
                **command_line,
            },
            "differences": classified["differences"],
            "unlisted": classified["unlisted"],
            "ok": not classified["unlisted"],
        }
    finally:
        await _maybe_await(server.close())
