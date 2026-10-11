"""Find installed Chrome-family browsers and guard their default profiles."""

from __future__ import annotations

import ntpath
import os
import posixpath
import re
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from .browser_sources import (
    BROWSER_SOURCES,
    resolve_browser_executables,
    resolve_browser_protection_roots,
)

CHANNEL_EXECUTABLE_NAMES: Mapping[str, tuple[str, ...]] = {
    name: tuple(browser.get("executableNames", []))
    for browser in BROWSER_SOURCES
    for name in [browser["id"], *browser.get("aliases", [])]
}

# Kept for callers that imported the private name.
_CHANNEL_EXECUTABLE_NAMES = CHANNEL_EXECUTABLE_NAMES


def _path_module(platform: str) -> Any:
    return ntpath if platform == "win32" else posixpath


def default_real_browser_user_data_dir(
    channel: str,
    *,
    home_dir: str | os.PathLike[str] | None = None,
    platform: str | None = None,
) -> str:
    """Return Browser Commander's managed profile path for a channel."""

    selected_platform = platform or sys.platform
    path_module = _path_module(selected_platform)
    home = os.fspath(home_dir) if home_dir is not None else str(Path.home())
    directory_name = re.sub(r"[^a-z0-9_.-]", "-", channel, flags=re.IGNORECASE)
    return path_module.join(
        home,
        ".browser-commander",
        "real-browser",
        directory_name,
    )


def known_default_user_data_dirs(
    *,
    platform: str | None = None,
    home_dir: str | os.PathLike[str] | None = None,
    environment: Mapping[str, str] | None = None,
) -> list[str]:
    """Return browser-owned paths forbidden as automation profiles for an OS."""

    selected_platform = platform or sys.platform
    home = os.fspath(home_dir) if home_dir is not None else str(Path.home())
    selected_environment = os.environ if environment is None else environment

    return [
        root
        for browser in BROWSER_SOURCES
        for root in resolve_browser_protection_roots(
            browser["id"],
            platform=selected_platform,
            home_dir=home,
            environment=selected_environment,
        )
    ]


def assert_dedicated_user_data_dir(
    user_data_dir: str | os.PathLike[str],
    *,
    platform: str | None = None,
    home_dir: str | os.PathLike[str] | None = None,
    environment: Mapping[str, str] | None = None,
) -> None:
    """Reject known default browser profiles before enabling remote debugging."""

    selected_platform = platform or sys.platform
    path_module = _path_module(selected_platform)

    def normalize(value: str | os.PathLike[str]) -> str:
        raw = os.fspath(value)
        if selected_platform == sys.platform:
            try:
                raw = str(Path(raw).resolve())
            except PermissionError:
                raw = str(Path(raw).absolute())
        normalized = path_module.normcase(path_module.abspath(raw))
        return normalized.rstrip("\\/")

    requested = normalize(user_data_dir)
    defaults = known_default_user_data_dirs(
        platform=selected_platform,
        home_dir=home_dir,
        environment=environment,
    )
    if any(
        requested == normalize(directory)
        or requested.startswith(normalize(directory) + path_module.sep)
        for directory in defaults
    ):
        msg = (
            "launch_real_browser requires a dedicated user_data_dir, "
            "not a browser default profile"
        )
        raise ValueError(msg)


def _browser_install_candidates(
    channel: str,
    *,
    platform: str | None = None,
    environment: Mapping[str, str] | None = None,
    home_dir: str | os.PathLike[str] | None = None,
) -> list[str]:
    selected_platform = platform or sys.platform
    selected_environment = os.environ if environment is None else environment
    names = CHANNEL_EXECUTABLE_NAMES.get(channel)
    if names is None:
        expected = ", ".join(CHANNEL_EXECUTABLE_NAMES)
        msg = f"Unknown browser channel: {channel}. Expected one of {expected}"
        raise ValueError(msg)

    return resolve_browser_executables(
        channel,
        platform=selected_platform,
        home_dir=home_dir,
        environment=selected_environment,
    )


def resolve_system_browser_executable(
    *,
    channel: str = "chrome",
    executable_path: str | os.PathLike[str] | None = None,
) -> str:
    """Resolve a genuine installed Chrome-family browser executable."""

    if executable_path is not None:
        candidates = [str(Path(executable_path).expanduser().resolve())]
    else:
        candidates = _browser_install_candidates(channel)

    for candidate in candidates:
        if Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return candidate

    if executable_path is not None:
        msg = f"Browser executable is not accessible: {executable_path}"
    else:
        msg = f"Could not find an installed {channel} browser; provide executable_path"
    raise FileNotFoundError(msg)
