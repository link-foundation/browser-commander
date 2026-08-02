"""Launch a genuine installed Chrome-family browser and attach over CDP."""

from __future__ import annotations

import asyncio
import inspect
import json
import ntpath
import os
import posixpath
import re
import sys
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.request import urlopen

from browser_commander.browser.connector import ConnectOptions, connect_browser
from browser_commander.browser.launcher import LaunchResult
from browser_commander.core.engine_detection import EngineType

_MANAGED_ARGUMENTS = (
    "--remote-debugging-address",
    "--remote-debugging-port",
    "--user-data-dir",
)

_CHANNEL_EXECUTABLE_NAMES = {
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


@dataclass
class RealBrowserOptions:
    """Configuration for starting an installed browser and attaching over CDP."""

    engine: EngineType = "playwright"
    channel: str = "chrome"
    executable_path: str | None = None
    user_data_dir: str | None = None
    remote_debugging_port: int = 0
    headless: bool = False
    args: list[str] = field(default_factory=list)
    startup_timeout: int = 30_000
    slow_mo: int | None = None
    timeout: int | None = None
    headers: dict[str, str] | None = None
    seed_cookies: list[dict[str, Any]] = field(default_factory=list)
    verbose: bool = False


@dataclass
class RealBrowserResult(LaunchResult):
    """Connected browser handles plus spawned-process metadata."""

    browser_process: Any
    cdp_endpoint: str
    executable_path: str
    user_data_dir: str


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
    names = _CHANNEL_EXECUTABLE_NAMES.get(channel)
    if names is None:
        expected = ", ".join(_CHANNEL_EXECUTABLE_NAMES)
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


def build_real_browser_args(
    *,
    user_data_dir: str | os.PathLike[str],
    remote_debugging_port: int = 0,
    headless: bool = False,
    args: list[str] | None = None,
) -> list[str]:
    """Build the protected command line for the installed browser process."""

    if (
        isinstance(remote_debugging_port, bool)
        or not isinstance(remote_debugging_port, int)
        or not 0 <= remote_debugging_port <= 65_535
    ):
        msg = "remote_debugging_port must be an integer from 0 to 65535"
        raise ValueError(msg)

    extra_args = args or []
    for argument in extra_args:
        if any(
            argument == managed or argument.startswith(f"{managed}=")
            for managed in _MANAGED_ARGUMENTS
        ):
            msg = f"{argument} is managed by launch_real_browser"
            raise ValueError(msg)

    return [
        "--remote-debugging-address=127.0.0.1",
        f"--remote-debugging-port={remote_debugging_port}",
        f"--user-data-dir={os.fspath(user_data_dir)}",
        "--no-first-run",
        "--no-default-browser-check",
        *(["--headless=new"] if headless else []),
        *extra_args,
    ]


def _fetch_cdp_version(endpoint: str, timeout_seconds: float) -> bool:
    with urlopen(
        f"{endpoint.rstrip('/')}/json/version",
        timeout=timeout_seconds,
    ) as response:
        if response.status != 200:
            return False
        payload = json.load(response)
    return bool(payload.get("webSocketDebuggerUrl"))


async def wait_for_cdp_endpoint(
    *,
    remote_debugging_port: int,
    user_data_dir: str | os.PathLike[str],
    browser_process: Any,
    startup_timeout: int = 30_000,
) -> str:
    """Wait until the spawned browser publishes a usable CDP endpoint."""

    if startup_timeout <= 0:
        msg = "startup_timeout must be greater than zero"
        raise ValueError(msg)

    loop = asyncio.get_running_loop()
    deadline = loop.time() + startup_timeout / 1000
    active_port_path = Path(user_data_dir) / "DevToolsActivePort"

    while loop.time() < deadline:
        if browser_process.returncode is not None:
            msg = (
                "Browser exited before its DevTools endpoint was ready "
                f"(exit {browser_process.returncode})"
            )
            raise RuntimeError(msg)

        port = remote_debugging_port
        if port == 0:
            try:
                port = int(active_port_path.read_text(encoding="utf-8").splitlines()[0])
            except (OSError, IndexError, ValueError):
                port = 0

        if port > 0:
            endpoint = f"http://127.0.0.1:{port}"
            remaining = max(0.001, deadline - loop.time())
            try:
                ready = await asyncio.to_thread(
                    _fetch_cdp_version,
                    endpoint,
                    min(remaining, 0.5),
                )
                if ready:
                    return endpoint
            except (OSError, TimeoutError, ValueError, json.JSONDecodeError):
                pass
        await asyncio.sleep(0.1)

    msg = f"Timed out after {startup_timeout}ms waiting for the DevTools endpoint"
    raise TimeoutError(msg)


async def _spawn_browser(
    executable: str,
    arguments: list[str],
    *,
    verbose: bool,
) -> asyncio.subprocess.Process:
    output = None if verbose else asyncio.subprocess.DEVNULL
    return await asyncio.create_subprocess_exec(
        executable,
        *arguments,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=output,
        stderr=output,
    )


async def _resolve(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


async def _terminate_process(process: Any) -> None:
    if process.returncode is not None:
        return
    process.terminate()
    wait = getattr(process, "wait", None)
    if wait is None:
        return
    pending = wait()
    if not inspect.isawaitable(pending):
        return
    try:
        await asyncio.wait_for(pending, timeout=5)
    except asyncio.TimeoutError:
        kill = getattr(process, "kill", None)
        if kill is not None:
            kill()
        await wait()


async def launch_real_browser(
    options: RealBrowserOptions | None = None,
) -> RealBrowserResult:
    """Start an installed browser with a dedicated profile and attach over CDP."""

    return await launch_real_browser_with_dependencies(options or RealBrowserOptions())


async def launch_real_browser_with_dependencies(
    options: RealBrowserOptions,
    *,
    resolve_executable: Any = resolve_system_browser_executable,
    spawn_browser: Any = _spawn_browser,
    wait_for_endpoint: Any = wait_for_cdp_endpoint,
    connect: Any = connect_browser,
) -> RealBrowserResult:
    """Dependency-injected implementation used by the public helper and tests."""

    if options.engine not in ("playwright", "selenium"):
        msg = f"Invalid engine: {options.engine}. Expected 'playwright' or 'selenium'"
        raise ValueError(msg)

    user_data_dir = options.user_data_dir or default_real_browser_user_data_dir(
        options.channel
    )
    assert_dedicated_user_data_dir(user_data_dir)
    Path(user_data_dir).mkdir(parents=True, exist_ok=True)

    executable_path = await _resolve(
        resolve_executable(
            channel=options.channel,
            executable_path=options.executable_path,
        )
    )
    arguments = build_real_browser_args(
        user_data_dir=user_data_dir,
        remote_debugging_port=options.remote_debugging_port,
        headless=options.headless,
        args=options.args,
    )
    browser_process = await _resolve(
        spawn_browser(executable_path, arguments, verbose=options.verbose)
    )

    try:
        cdp_endpoint = await _resolve(
            wait_for_endpoint(
                remote_debugging_port=options.remote_debugging_port,
                user_data_dir=user_data_dir,
                browser_process=browser_process,
                startup_timeout=options.startup_timeout,
            )
        )
        connection = await _resolve(
            connect(
                ConnectOptions(
                    engine=options.engine,
                    cdp_endpoint=cdp_endpoint,
                    slow_mo=options.slow_mo,
                    timeout=options.timeout,
                    headers=options.headers,
                    seed_cookies=options.seed_cookies,
                    verbose=options.verbose,
                )
            )
        )
    except BaseException:
        await _terminate_process(browser_process)
        raise

    return RealBrowserResult(
        browser=connection.browser,
        page=connection.page,
        browser_process=browser_process,
        cdp_endpoint=cdp_endpoint,
        executable_path=str(executable_path),
        user_data_dir=str(user_data_dir),
    )


# Retain the descriptive helper name introduced by the JavaScript API.
launch_and_connect_real_browser = launch_real_browser
