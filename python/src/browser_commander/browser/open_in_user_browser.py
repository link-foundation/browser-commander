"""Hand a URL to the operating system's default browser with no automation.

This is the mode for flows where a consumer only needs the user to see and
approve a page (an OAuth screen or a CLI web login) in the browser where they
are already signed in. Nothing is driven, nothing is migrated and no dedicated
profile is created.

Each platform has one canonical opener:

- macOS: ``open <url>``
- Linux: ``xdg-open <url>``
- Windows: ``explorer.exe <url>`` (Explorer hands the URL to the registered
  browser without a ``cmd.exe`` parser seeing its query string)

The opener runs through :func:`browser_commander.utilities.subprocess.run_command`
with exact argv boundaries and no shell, so a URL is never reinterpreted as
shell syntax.
"""

from __future__ import annotations

import inspect
import json
import re
import sys
from collections.abc import Mapping
from typing import Any, Callable
from urllib.parse import urlsplit

from browser_commander.utilities.subprocess import run_command

__all__ = [
    "ALLOWED_OPEN_PROTOCOLS",
    "PLATFORM_OPENERS",
    "build_open_command",
    "open_in_user_browser",
    "validate_open_url",
]

#: Platform openers as ``(file, *fixed_args)``; the URL is appended last.
PLATFORM_OPENERS: dict[str, tuple[str, ...]] = {
    "darwin": ("open",),
    "linux": ("xdg-open",),
    "win32": ("explorer.exe",),
}

#: URL schemes a browser opens. The openers would also launch local
#: applications for other schemes, so the set is limited to web pages.
ALLOWED_OPEN_PROTOCOLS = (
    "http:",
    "https:",
    "file:",
    "ftp:",
    "about:",
    "chrome:",
    "edge:",
    "view-source:",
)

_SCHEME = re.compile(r"[A-Za-z][A-Za-z0-9+.\-]*")
# The WHATWG URL parser strips leading and trailing C0 controls and spaces.
_C0_CONTROL_OR_SPACE = "".join(chr(code) for code in range(0x21))
# Schemes the WHATWG URL parser requires a host for.
_HOST_REQUIRED = frozenset({"http", "https", "ftp", "ws", "wss"})


def _quoted(url: str) -> str:
    return json.dumps(url, ensure_ascii=False)


def _protocol_of(url: str) -> str | None:
    """The lower-case ``scheme:`` of an absolute URL, or ``None`` if invalid."""

    candidate = url.strip(_C0_CONTROL_OR_SPACE)
    scheme, separator, _ = candidate.partition(":")
    if not separator or not _SCHEME.fullmatch(scheme):
        return None
    scheme = scheme.lower()
    if scheme in _HOST_REQUIRED:
        try:
            parts = urlsplit(candidate)
            hostname = parts.hostname
            _ = parts.port
        except ValueError:
            return None
        if not hostname:
            return None
    return f"{scheme}:"


def validate_open_url(url: Any) -> str:
    """Validate a URL before it reaches an opener.

    A string starting with ``-`` would be read by the opener as an option, so
    it is rejected outright; every other string must be an absolute URL with
    an allowed scheme.

    Raises:
        TypeError: When ``url`` is not a non-empty string.
        ValueError: When the URL is refused.
    """

    if not isinstance(url, str) or not url:
        msg = "open_in_user_browser requires a URL string"
        raise TypeError(msg)
    if url.startswith("-"):
        msg = (
            f"Refusing to open {_quoted(url)}: a URL cannot start with "
            '"-", which an opener would read as an option'
        )
        raise ValueError(msg)
    protocol = _protocol_of(url)
    if protocol is None:
        msg = f"Refusing to open {_quoted(url)}: it is not a valid absolute URL"
        raise ValueError(msg)
    if protocol not in ALLOWED_OPEN_PROTOCOLS:
        msg = (
            f"Refusing to open {_quoted(url)}: {protocol} is not one of "
            f"{', '.join(ALLOWED_OPEN_PROTOCOLS)}"
        )
        raise ValueError(msg)
    return url


def build_open_command(url: str, platform: str) -> list[str]:
    """Return the exact ``[file, *args]`` for the platform's opener.

    Raises:
        ValueError: On a platform without an opener.
    """

    opener = PLATFORM_OPENERS.get(platform)
    if opener is None:
        msg = (
            f"open_in_user_browser is not supported on {platform}; supported "
            f"platforms are {', '.join(PLATFORM_OPENERS)}"
        )
        raise ValueError(msg)
    return [*opener, url]


async def open_in_user_browser(
    url: str,
    *,
    platform: str | None = None,
    runner: Callable[..., Any] | None = None,
    env: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Open ``url`` in the user's default browser with no automation.

    Args:
        url: The page to open (http, https, file, ftp, about, ...).
        platform: ``darwin``/``linux``/``win32``; defaults to ``sys.platform``.
        runner: ``runner(file, args, env=...)``, sync or async; defaults to
            :func:`run_command`. ``env`` is passed only when given.
        env: Environment for the opener process.

    Returns:
        ``{"opened": url, "command": [file, *args]}``.
    """

    validated = validate_open_url(url)
    command = build_open_command(
        validated, sys.platform if platform is None else platform
    )
    file, *args = command
    run = run_command if runner is None else runner
    result = run(file, args, env=env) if env else run(file, args)
    if inspect.isawaitable(result):
        await result
    return {"opened": validated, "command": command}
