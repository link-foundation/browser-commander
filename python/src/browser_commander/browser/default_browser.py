"""Resolve the operating-system default web browser to a catalogue id (#114).

This is what lets ``browser: 'default'`` import from whichever browser a person
actually uses. Each platform records the default differently:

- macOS keeps it in the LaunchServices database as the ``https`` URL-scheme
  handler's bundle id (``defaults read
  com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers``).
- Linux reports it through ``xdg-settings get default-web-browser`` (a
  ``.desktop`` file name), falling back to the ``x-scheme-handler/https``
  association from ``xdg-mime``.
- Windows stores the ``https`` UserChoice ProgId under
  ``HKCU\\...\\UrlAssociations\\https\\UserChoice``.

Every lookup runs through an injected command runner so the resolver is
deterministic in tests, and the raw identifier is matched against the
``default`` identifiers each browser declares in ``browser-sources.json``.
"""

from __future__ import annotations

import os
import re
import sys
from collections.abc import Mapping, Sequence
from contextlib import suppress
from typing import Callable

from browser_commander.browser.browser_sources import BROWSER_SOURCES
from browser_commander.utilities.subprocess import run_command_sync

#: A command runner: ``(command, args, environment) -> stdout``.
RunCommand = Callable[[str, Sequence[str], Mapping[str, str]], str]


def _default_run_command(
    command: str, args: Sequence[str], environment: Mapping[str, str]
) -> str:
    return run_command_sync(command, args, env=environment, check=False).stdout


def browser_for_identifier(identifier: str | None, platform: str) -> str | None:
    """Match a raw OS identifier (bundle id, ``.desktop`` name, or ProgId).

    Comparison is case-insensitive because the registry and the operating
    systems disagree on casing.
    """
    if not identifier:
        return None
    needle = identifier.strip().lower()
    if not needle:
        return None
    for source in BROWSER_SOURCES:
        identifiers = source.get("default", {}).get(platform, [])
        if any(candidate.lower() == needle for candidate in identifiers):
            return source["id"]
    return None


def parse_mac_launch_services_handler(output: str) -> str | None:
    """Read the https handler bundle id from ``defaults read`` plist text.

    ``defaults read`` prints NeXTSTEP-style plist text; each handler is a brace
    block that may carry an ``LSHandlerURLScheme`` and an ``LSHandlerRoleAll``
    bundle id. Find the block that handles https and read its bundle id.
    """
    for block in output.split("}"):
        if not re.search(r'LSHandlerURLScheme\s*=\s*"?https"?\s*;', block):
            continue
        match = re.search(r'LSHandlerRoleAll\s*=\s*"?([^";]+)"?\s*;', block)
        if match:
            return match.group(1).strip()
    return None


def parse_windows_prog_id(output: str) -> str | None:
    """Read the ProgId value from ``reg query`` output.

    ``reg query`` prints ``    ProgId    REG_SZ    FirefoxHTML``; take the last
    whitespace-separated token of the ProgId line.
    """
    for line in re.split(r"\r?\n", output):
        if re.search(r"\bProgId\b", line, re.IGNORECASE):
            tokens = line.strip().split()
            return tokens[-1] if tokens else None
    return None


def _resolve_darwin_default(
    run_command: RunCommand, environment: Mapping[str, str]
) -> str | None:
    output = ""
    with suppress(Exception):
        output = run_command(
            "defaults",
            [
                "read",
                "com.apple.LaunchServices/com.apple.launchservices.secure",
                "LSHandlers",
            ],
            environment,
        )
    legacy = browser_for_identifier(parse_mac_launch_services_handler(output), "darwin")
    if legacy:
        return legacy
    with suppress(Exception):
        script = "ObjC.import('AppKit'); var app = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString('https://example.invalid')); app ? ObjC.unwrap($.NSBundle.bundleWithURL(app).bundleIdentifier) : ''"
        return browser_for_identifier(
            run_command("osascript", ["-l", "JavaScript", "-e", script], environment),
            "darwin",
        )
    return None


def _resolve_linux_default(
    run_command: RunCommand, environment: Mapping[str, str]
) -> str | None:
    desktop = ""
    # xdg-settings may be absent or fail; fall through to the xdg-mime query.
    with suppress(Exception):
        desktop = run_command(
            "xdg-settings", ["get", "default-web-browser"], environment
        ).strip()
    resolved = browser_for_identifier(desktop, "linux")
    if resolved:
        return resolved
    try:
        fallback = run_command(
            "xdg-mime", ["query", "default", "x-scheme-handler/https"], environment
        ).strip()
        resolved = browser_for_identifier(fallback, "linux")
    except Exception:  # mirror the JS catch-all; any tool failure means "unknown"
        resolved = None
    return resolved


def _resolve_windows_default(
    run_command: RunCommand, environment: Mapping[str, str]
) -> str | None:
    try:
        output = run_command(
            "reg",
            [
                "query",
                "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations"
                "\\UrlAssociations\\https\\UserChoice",
                "/v",
                "ProgId",
            ],
            environment,
        )
    except Exception:  # mirror the JS catch-all; any tool failure means "unknown"
        return None
    return browser_for_identifier(parse_windows_prog_id(output), "win32")


def resolve_default_browser(
    *,
    platform: str = sys.platform,
    environment: Mapping[str, str] | None = None,
    run_command: RunCommand | None = None,
) -> str | None:
    """Resolve the system default browser to a canonical catalogue id.

    Returns ``None`` when the default cannot be determined (an unknown
    platform, or the OS reports a browser not in the catalogue).
    """
    env = os.environ if environment is None else environment
    runner = _default_run_command if run_command is None else run_command
    if platform == "darwin":
        return _resolve_darwin_default(runner, env)
    if platform == "linux":
        return _resolve_linux_default(runner, env)
    if platform == "win32":
        return _resolve_windows_default(runner, env)
    return None


__all__ = [
    "browser_for_identifier",
    "parse_mac_launch_services_handler",
    "parse_windows_prog_id",
    "resolve_default_browser",
]
