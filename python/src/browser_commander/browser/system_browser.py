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

CHANNEL_EXECUTABLE_NAMES: Mapping[str, tuple[str, ...]] = {
    "brave": ("brave-browser", "brave-browser-stable", "brave"),
    "chrome": ("google-chrome", "google-chrome-stable", "chrome"),
    "chrome-beta": ("google-chrome-beta",),
    "chrome-canary": ("google-chrome-canary",),
    "chrome-dev": ("google-chrome-unstable",),
    "chromium": ("chromium", "chromium-browser"),
    "msedge": ("microsoft-edge", "microsoft-edge-stable", "msedge"),
    "msedge-beta": ("microsoft-edge-beta",),
    "msedge-canary": ("microsoft-edge-canary",),
    "msedge-dev": ("microsoft-edge-dev",),
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
    """Return known default Chrome-family profile roots for an OS."""

    selected_platform = platform or sys.platform
    path_module = _path_module(selected_platform)
    home = os.fspath(home_dir) if home_dir is not None else str(Path.home())
    selected_environment = os.environ if environment is None else environment

    if selected_platform == "darwin":
        support = path_module.join(home, "Library", "Application Support")
        return [
            path_module.join(support, "Google", name)
            for name in ("Chrome", "Chrome Beta", "Chrome Canary", "Chrome Dev")
        ] + [
            path_module.join(support, *parts)
            for parts in (
                ("Chromium",),
                ("BraveSoftware", "Brave-Browser"),
                ("BraveSoftware", "Brave-Browser-Beta"),
                ("BraveSoftware", "Brave-Browser-Nightly"),
                ("Microsoft Edge",),
                ("Microsoft Edge Beta",),
                ("Microsoft Edge Canary",),
                ("Microsoft Edge Dev",),
            )
        ]

    if selected_platform == "win32":
        local_app_data = selected_environment.get(
            "LOCALAPPDATA",
            path_module.join(home, "AppData", "Local"),
        )
        return [
            path_module.join(local_app_data, *parts)
            for parts in (
                ("Google", "Chrome", "User Data"),
                ("Google", "Chrome Beta", "User Data"),
                ("Google", "Chrome Dev", "User Data"),
                ("Google", "Chrome SxS", "User Data"),
                ("Chromium", "User Data"),
                ("BraveSoftware", "Brave-Browser", "User Data"),
                ("BraveSoftware", "Brave-Browser-Beta", "User Data"),
                ("BraveSoftware", "Brave-Browser-Nightly", "User Data"),
                ("Microsoft", "Edge", "User Data"),
                ("Microsoft", "Edge Beta", "User Data"),
                ("Microsoft", "Edge Dev", "User Data"),
                ("Microsoft", "Edge SxS", "User Data"),
            )
        ]

    return [
        path_module.join(home, ".config", *parts)
        for parts in (
            ("google-chrome",),
            ("google-chrome-beta",),
            ("google-chrome-unstable",),
            ("chromium",),
            ("BraveSoftware", "Brave-Browser"),
            ("BraveSoftware", "Brave-Browser-Beta"),
            ("BraveSoftware", "Brave-Browser-Nightly"),
            ("microsoft-edge",),
            ("microsoft-edge-beta",),
            ("microsoft-edge-dev",),
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
        normalized = path_module.normcase(path_module.abspath(os.fspath(value)))
        return normalized.rstrip("\\/")

    requested = normalize(user_data_dir)
    defaults = known_default_user_data_dirs(
        platform=selected_platform,
        home_dir=home_dir,
        environment=environment,
    )
    if any(normalize(directory) == requested for directory in defaults):
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

    candidates: list[str] = []
    if selected_platform == "darwin":
        applications = {
            "brave": "Brave Browser.app/Contents/MacOS/Brave Browser",
            "chrome": "Google Chrome.app/Contents/MacOS/Google Chrome",
            "chrome-beta": "Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
            "chrome-canary": "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
            "chrome-dev": "Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev",
            "chromium": "Chromium.app/Contents/MacOS/Chromium",
            "msedge": "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "msedge-beta": "Microsoft Edge Beta.app/Contents/MacOS/Microsoft Edge Beta",
            "msedge-canary": "Microsoft Edge Canary.app/Contents/MacOS/Microsoft Edge Canary",
            "msedge-dev": "Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev",
        }
        relative = applications[channel]
        candidates.append(posixpath.join("/Applications", relative))
        home = os.fspath(home_dir) if home_dir is not None else str(Path.home())
        candidates.append(posixpath.join(home, "Applications", relative))
    elif selected_platform == "win32":
        relative_paths = {
            "brave": ("BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
            "chrome": ("Google", "Chrome", "Application", "chrome.exe"),
            "chrome-beta": ("Google", "Chrome Beta", "Application", "chrome.exe"),
            "chrome-canary": ("Google", "Chrome SxS", "Application", "chrome.exe"),
            "chrome-dev": ("Google", "Chrome Dev", "Application", "chrome.exe"),
            "chromium": ("Chromium", "Application", "chrome.exe"),
            "msedge": ("Microsoft", "Edge", "Application", "msedge.exe"),
            "msedge-beta": ("Microsoft", "Edge Beta", "Application", "msedge.exe"),
            "msedge-canary": ("Microsoft", "Edge SxS", "Application", "msedge.exe"),
            "msedge-dev": ("Microsoft", "Edge Dev", "Application", "msedge.exe"),
        }
        roots = (
            selected_environment.get("PROGRAMFILES"),
            selected_environment.get("PROGRAMFILES(X86)"),
            selected_environment.get("LOCALAPPDATA"),
        )
        candidates.extend(
            ntpath.join(root, *relative_paths[channel]) for root in roots if root
        )
    else:
        for name in names:
            candidates.extend((f"/usr/bin/{name}", f"/usr/local/bin/{name}"))
        if channel == "chrome":
            candidates.append("/opt/google/chrome/google-chrome")

    path_module = _path_module(selected_platform)
    separator = ";" if selected_platform == "win32" else os.pathsep
    for directory in selected_environment.get("PATH", "").split(separator):
        if not directory:
            continue
        for name in names:
            executable_name = f"{name}.exe" if selected_platform == "win32" else name
            candidates.append(path_module.join(directory, executable_name))
    return list(dict.fromkeys(candidates))


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
