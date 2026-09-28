"""Launch a genuine installed Chrome-family browser and attach over CDP.

The browser is started exactly like a person who wants to attach a debugger
would start it: ``--user-data-dir=<dir> --remote-debugging-port=<port>`` and
nothing else unless asked for (issues #101 and #103). The fixed, reserved port
keeps ``navigator.webdriver`` false; port 0 is refused because it makes Chrome
enable AutomationControlled.
"""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import json
import os
from collections.abc import Awaitable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable
from urllib.request import urlopen

from browser_commander.browser.connector import ConnectOptions, connect_browser
from browser_commander.browser.debugging_port import (
    LOOPBACK_HOST,
    DevToolsOutputWatcher,
    PortRaceError,
    assert_fixed_debugging_port,
    classify_dev_tools_ownership,
    reserve_loopback_port,
    watch_dev_tools_output,
)
from browser_commander.browser.launcher import LaunchResult
from browser_commander.browser.profile_directory import (
    create_temporary_user_data_dir,
    prepare_user_data_dir,
    remove_user_data_dir,
)
from browser_commander.browser.restrictions import (
    assert_string_array,
    browser_environment,
    merge_feature_switches,
    resolve_restrictions,
)
from browser_commander.browser.system_browser import (
    _CHANNEL_EXECUTABLE_NAMES,
    CHANNEL_EXECUTABLE_NAMES,
    _browser_install_candidates,
    assert_dedicated_user_data_dir,
    default_real_browser_user_data_dir,
    known_default_user_data_dirs,
    resolve_system_browser_executable,
)
from browser_commander.core.engine_detection import EngineType
from browser_commander.fingerprint.automation_parity import (
    apply_automation_parity_args,
    detect_automation_controlled_triggers,
)
from browser_commander.utilities.subprocess import ManagedProcess, start_process

__all__ = [
    "CHANNEL_EXECUTABLE_NAMES",
    "MANAGED_ARGUMENTS",
    "_CHANNEL_EXECUTABLE_NAMES",
    "RealBrowserOptions",
    "RealBrowserResult",
    "_browser_install_candidates",
    "assert_dedicated_user_data_dir",
    "build_real_browser_args",
    "default_real_browser_user_data_dir",
    "known_default_user_data_dirs",
    "launch_and_connect_real_browser",
    "launch_real_browser",
    "launch_real_browser_with_dependencies",
    "resolve_system_browser_executable",
    "wait_for_cdp_endpoint",
]

#: Switches the launcher owns. Letting a caller pass them would break the
#: guarantees of this path: DevTools bound to loopback only, a dedicated
#: profile, and no switch that turns AutomationControlled on (issue #101).
MANAGED_ARGUMENTS = (
    "--remote-debugging-address",
    "--remote-debugging-port",
    "--remote-debugging-pipe",
    "--user-data-dir",
)
_MANAGED_ARGUMENTS = MANAGED_ARGUMENTS


@dataclass
class RealBrowserOptions:
    """Configuration for starting an installed browser and attaching over CDP."""

    engine: EngineType = "playwright"
    channel: str = "chrome"
    executable_path: str | None = None
    user_data_dir: str | None = None
    """Persistent dedicated profile. When omitted a fresh temporary profile is
    created and deleted on close (and when the browser exits)."""
    remote_debugging_port: int | None = None
    """Fixed loopback CDP port. When omitted a free port is reserved (and
    re-reserved on a port race). Zero is refused because it sets
    ``navigator.webdriver``."""
    port_attempts: int = 3
    """Launch attempts when a reserved port is lost to a race."""
    headless: bool = False
    restrictions: list[str] = field(default_factory=list)
    """Opt-in restrictions from ``launch-restrictions.json``, such as
    ``"no-extensions"`` or the ``"legacy-defaults"`` preset."""
    args: list[str] = field(default_factory=list)
    extra_args: list[str] = field(default_factory=list)
    ignore_default_args: bool | list[str] = field(default_factory=list)
    """Ignored: a real launch adds no default switches to opt out of. Kept so
    existing callers keep working."""
    env: Mapping[str, str] | None = None
    """Extra environment for the browser process only."""
    automation_parity: bool = True
    """Keep ``navigator.webdriver`` false when a switch (``--headless``) would
    turn AutomationControlled on."""
    startup_timeout: int = 30_000
    """CDP readiness timeout in milliseconds."""
    close_timeout: int = 5_000
    """Milliseconds ``close()`` waits for the browser to exit before killing it."""
    slow_mo: int | None = None
    timeout: int | None = None
    headers: dict[str, str] | None = None
    seed_cookies: list[dict[str, Any]] = field(default_factory=list)
    verbose: bool = False
    downloads: bool | Mapping[str, Any] | None = None
    """Manage downloads: ``True`` for defaults, or a mapping with ``directory``,
    ``persist`` and ``conflict``."""


@dataclass
class RealBrowserResult(LaunchResult):
    """Connected browser handles plus spawned-process metadata.

    ``close()`` asks the browser to shut down, kills it after
    ``close_timeout`` and deletes a temporary profile. For Playwright the
    returned ``browser.close()`` does the same.
    """


#: The page a real launch opens, as Puppeteer and Playwright do. Without a URL,
#: Chrome opens its New Tab page and Microsoft Edge opens the MSN New Tab page
#: plus ``edge://welcome-new-profile/``, whose flow closes the window and exits
#: the browser a few seconds after launch (measured with Edge 153,
#: experiments/issue-103/edge-headful.mjs). A URL is not a switch, so every
#: engine sees the command line a person gets from ``chrome about:blank``.
START_URL = "about:blank"


def build_real_browser_args(
    *,
    user_data_dir: str | os.PathLike[str],
    remote_debugging_port: int,
    headless: bool = False,
    restrictions: list[str] | None = None,
    args: list[str] | None = None,
    extra_args: list[str] | None = None,
    automation_parity: bool = True,
) -> list[str]:
    """Build the command line for a real browser.

    By default it is exactly ``--user-data-dir=<dir>
    --remote-debugging-port=<port> about:blank`` (issue #103). Everything else
    is opt-in: ``headless``, named ``restrictions`` and custom ``args``; a start
    URL among the custom ``args`` replaces ``about:blank``. Chrome's DevTools
    server binds to loopback by default, so no ``--remote-debugging-address``
    is passed; the switch stays managed so custom arguments cannot expose
    DevTools on another interface.

    A hand-started headless browser reports ``navigator.webdriver`` false, so
    headless adds no off switch; it is added only when a custom argument is an
    AutomationControlled trigger, unless ``automation_parity`` is false.

    Raises:
        ValueError: For port 0, an invalid port, or a managed switch in ``args``.
        TypeError: When ``args``/``extra_args``/``restrictions`` are not lists
            of strings.
    """

    assert_fixed_debugging_port(remote_debugging_port)
    custom_args = [
        *assert_string_array([] if args is None else args, "args"),
        *assert_string_array([] if extra_args is None else extra_args, "extra_args"),
    ]
    for argument in custom_args:
        if any(
            argument == managed or argument.startswith(f"{managed}=")
            for managed in MANAGED_ARGUMENTS
        ):
            msg = f"{argument} is managed by launch_real_browser"
            raise ValueError(msg)

    browser_args = merge_feature_switches(
        [
            f"--user-data-dir={os.fspath(user_data_dir)}",
            f"--remote-debugging-port={remote_debugging_port}",
            *(["--headless=new"] if headless else []),
            *resolve_restrictions(restrictions).args,
            *custom_args,
        ]
    )
    if automation_parity and detect_automation_controlled_triggers(browser_args):
        browser_args = apply_automation_parity_args(browser_args)
    if all(argument.startswith("-") for argument in browser_args):
        browser_args.append(START_URL)
    return browser_args


def _fetch_cdp_version(endpoint: str, timeout_seconds: float) -> dict[str, Any] | None:
    with urlopen(
        f"{endpoint.rstrip('/')}/json/version",
        timeout=timeout_seconds,
    ) as response:
        if response.status != 200:
            return None
        payload = json.load(response)
    if isinstance(payload, dict) and payload.get("webSocketDebuggerUrl"):
        return payload
    return None


def _read_dev_tools_active_port(user_data_dir: str | os.PathLike[str]) -> int | None:
    try:
        content = (Path(user_data_dir) / "DevToolsActivePort").read_text(
            encoding="utf-8"
        )
        return int(content.splitlines()[0])
    except (OSError, IndexError, ValueError):
        return None


def _exit_code(process: Any) -> int | None:
    code = getattr(process, "exit_code", None)
    return code if code is not None else getattr(process, "returncode", None)


async def _resolve(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


async def wait_for_cdp_endpoint(
    *,
    remote_debugging_port: int,
    user_data_dir: str | os.PathLike[str],
    browser_process: Any,
    dev_tools_output: DevToolsOutputWatcher | None = None,
    startup_timeout: int = 30_000,
    fetch_version: Callable[[str, float], Any] | None = None,
) -> str:
    """Wait for the spawned browser's DevTools endpoint and prove it is ours.

    Proof comes from the browser's own stderr (``DevTools listening on
    ws://127.0.0.1:<port>/devtools/browser/<id>``), whose URL must equal the
    ``webSocketDebuggerUrl`` served on the port. Chrome writes
    ``DevToolsActivePort`` only for port 0, so the file is accepted as proof
    when present (for callers that bring their own spawn) but never required.

    Args:
        startup_timeout: Milliseconds to wait.
        fetch_version: ``(endpoint, timeout_seconds) -> dict | None`` returning
            the ``/json/version`` payload; for tests.

    Raises:
        PortRaceError: When another process holds the port.
        RuntimeError: When the browser exits first.
        TimeoutError: When nothing proves ownership in time.
    """

    port = assert_fixed_debugging_port(remote_debugging_port)
    if startup_timeout <= 0:
        msg = "startup_timeout must be greater than zero"
        raise ValueError(msg)
    output_watcher = dev_tools_output or watch_dev_tools_output(
        getattr(browser_process, "stderr", None)
    )
    fetch = fetch_version or _fetch_cdp_version
    endpoint = f"http://{LOOPBACK_HOST}:{port}"
    loop = asyncio.get_running_loop()
    deadline = loop.time() + startup_timeout / 1000

    while loop.time() < deadline:
        output = output_watcher.state()
        ownership = (
            classify_dev_tools_ownership(output, port)
            if output_watcher.available
            else "unknown"
        )
        if ownership == "race":
            detail = output.listening.url if output.listening else "bind failed"
            raise PortRaceError(port, detail)
        code = _exit_code(browser_process)
        if code is not None:
            msg = f"Browser exited before its DevTools endpoint was ready (exit {code})"
            raise RuntimeError(msg)
        if ownership != "owned" and _read_dev_tools_active_port(user_data_dir) == port:
            ownership = "owned"

        if ownership == "owned":
            version = None
            remaining = max(0.001, deadline - loop.time())
            try:
                version = await _resolve(
                    await asyncio.to_thread(fetch, endpoint, min(remaining, 0.5))
                )
            except (OSError, TimeoutError, ValueError):
                # The HTTP handler can lag the listening line by a moment.
                version = None
            if version:
                expected = output.listening.url if output.listening else None
                served = version.get("webSocketDebuggerUrl")
                if expected and served != expected:
                    raise PortRaceError(
                        port, f"port serves {served}, browser announced {expected}"
                    )
                return endpoint
        await asyncio.sleep(0.1)

    msg = (
        f"Timed out after {startup_timeout}ms waiting for the DevTools "
        f"endpoint on port {port}"
    )
    raise TimeoutError(msg)


async def _spawn_browser(
    executable: str,
    arguments: list[str],
    *,
    env: Mapping[str, str] | None = None,
    verbose: bool = False,
) -> ManagedProcess:
    return await start_process(executable, arguments, env=env, forward_output=verbose)


def _kill(process: Any) -> None:
    if _exit_code(process) is not None:
        return
    with contextlib.suppress(ProcessLookupError, OSError):
        if isinstance(process, ManagedProcess) or not hasattr(process, "terminate"):
            process.kill()
        else:
            process.terminate()


async def _wait_for_exit(process: Any, timeout_ms: float) -> bool:
    """Wait up to ``timeout_ms`` for ``process`` to exit; report whether it did."""

    if _exit_code(process) is not None:
        return True
    wait = getattr(process, "wait", None)
    pending: Any = None
    if callable(wait):
        pending = wait()
    elif callable(getattr(process, "once", None)):
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()

        def exited(_code: Any = None) -> None:
            if not future.done():
                future.set_result(True)

        process.once("exit", exited)
        pending = future
    if not inspect.isawaitable(pending):
        return _exit_code(process) is not None
    try:
        await asyncio.wait_for(pending, timeout=max(0.0, timeout_ms / 1000))
    except asyncio.TimeoutError:
        return _exit_code(process) is not None
    return True


def _remove_quietly(user_data_dir: str) -> None:
    with contextlib.suppress(OSError):
        remove_user_data_dir(user_data_dir)


async def _remove_profile(user_data_dir: str) -> None:
    await asyncio.to_thread(_remove_quietly, user_data_dir)


async def _request_browser_close(
    engine: str, browser: Any, original_close: Any
) -> None:
    if engine == "selenium":
        # Selenium attached through debuggerAddress; quit() would only end the
        # ChromeDriver session, so ask Chrome itself to shut down first.
        with contextlib.suppress(Exception):
            await asyncio.to_thread(browser.execute_cdp_cmd, "Browser.close", {})
        with contextlib.suppress(Exception):
            await asyncio.to_thread(browser.quit)
        return
    # Playwright's close() only disconnects from a connect_over_cdp browser,
    # so ask Chrome itself to shut down, then drop the connection.
    session = await browser.new_browser_cdp_session()
    with contextlib.suppress(Exception):
        await session.send("Browser.close")
    if original_close is not None:
        with contextlib.suppress(Exception):
            await original_close()


def _create_closer(
    *,
    engine: str,
    browser: Any,
    browser_process: Any,
    user_data_dir: str,
    temporary_profile: bool,
    close_timeout: int,
) -> Callable[..., Awaitable[None]]:
    original_close = getattr(browser, "close", None) if browser is not None else None
    closing: asyncio.Future[None] | None = None

    async def shut_down() -> None:
        if _exit_code(browser_process) is None and browser is not None:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(
                    _request_browser_close(engine, browser, original_close),
                    timeout=close_timeout / 1000,
                )
        if not await _wait_for_exit(browser_process, close_timeout):
            _kill(browser_process)
            await _wait_for_exit(browser_process, close_timeout)
        if temporary_profile:
            await _remove_profile(user_data_dir)

    async def close(*_args: Any, **_kwargs: Any) -> None:
        nonlocal closing
        if closing is None:
            closing = asyncio.ensure_future(shut_down())
        await asyncio.shield(closing)

    if engine == "playwright" and browser is not None and original_close is not None:
        # browser.close() means "close the browser" for every caller, so it
        # shuts the spawned process down and deletes a temporary profile too.
        with contextlib.suppress(AttributeError, TypeError):
            browser.close = close
    return close


async def launch_real_browser(
    options: RealBrowserOptions | None = None,
) -> RealBrowserResult:
    """Start an installed browser with a dedicated profile and attach over CDP.

    The command line is ``--user-data-dir=<dir> --remote-debugging-port=<port>``
    and nothing else unless asked for, so the session is as close to a
    hand-started browser as CDP allows and ``navigator.webdriver`` is false.
    """

    return await launch_real_browser_with_dependencies(options or RealBrowserOptions())


# Retain the descriptive helper name introduced by the JavaScript API.
launch_and_connect_real_browser = launch_real_browser


def _validate_launch_request(options: RealBrowserOptions) -> None:
    """Reject a launch request before anything touches the disk."""

    if options.engine not in ("playwright", "selenium"):
        msg = f"Invalid engine: {options.engine}. Expected 'playwright' or 'selenium'"
        raise ValueError(msg)
    if options.remote_debugging_port is not None:
        assert_fixed_debugging_port(options.remote_debugging_port)
    if (
        isinstance(options.port_attempts, bool)
        or not isinstance(options.port_attempts, int)
        or options.port_attempts < 1
    ):
        msg = "port_attempts must be a positive integer"
        raise ValueError(msg)
    build_real_browser_args(
        user_data_dir=options.user_data_dir or "validation",
        remote_debugging_port=options.remote_debugging_port or 1,
        headless=options.headless,
        restrictions=options.restrictions,
        args=options.args,
        extra_args=options.extra_args,
        automation_parity=options.automation_parity,
    )
    if options.user_data_dir:
        assert_dedicated_user_data_dir(options.user_data_dir)


@dataclass
class _Launched:
    browser_process: Any
    cdp_endpoint: str
    port: int
    args: list[str]


async def _spawn_on_free_port(
    options: RealBrowserOptions,
    *,
    executable_path: str,
    user_data_dir: str,
    env: dict[str, str] | None,
    reserve_port: Any,
    spawn_browser: Any,
    wait_for_endpoint: Any,
) -> _Launched:
    requested_port = options.remote_debugging_port
    attempts = options.port_attempts if requested_port is None else 1
    attempt = 0
    while True:
        attempt += 1
        port = requested_port or int(await _resolve(reserve_port()))
        browser_args = build_real_browser_args(
            user_data_dir=user_data_dir,
            remote_debugging_port=port,
            headless=options.headless,
            restrictions=options.restrictions,
            args=options.args,
            extra_args=options.extra_args,
            automation_parity=options.automation_parity,
        )
        browser_process = await _resolve(
            spawn_browser(
                executable_path, browser_args, env=env, verbose=options.verbose
            )
        )
        try:
            cdp_endpoint = await _resolve(
                wait_for_endpoint(
                    remote_debugging_port=port,
                    user_data_dir=user_data_dir,
                    browser_process=browser_process,
                    startup_timeout=options.startup_timeout,
                )
            )
            return _Launched(browser_process, str(cdp_endpoint), port, browser_args)
        except BaseException as error:
            _kill(browser_process)
            if not isinstance(error, PortRaceError) or attempt >= attempts:
                if not isinstance(error, PortRaceError):
                    await _wait_for_exit(browser_process, options.close_timeout)
                raise
            if options.verbose:
                print(f"{error}; retrying with a new port")
            await _wait_for_exit(browser_process, 5_000)


async def launch_real_browser_with_dependencies(
    options: RealBrowserOptions,
    *,
    resolve_executable: Any = resolve_system_browser_executable,
    spawn_browser: Any = _spawn_browser,
    wait_for_endpoint: Any = wait_for_cdp_endpoint,
    connect: Any = connect_browser,
    reserve_port: Any = reserve_loopback_port,
) -> RealBrowserResult:
    """Dependency-injected implementation used by the public helper and tests."""

    _validate_launch_request(options)
    executable_path = str(
        await _resolve(
            resolve_executable(
                channel=options.channel,
                executable_path=options.executable_path,
            )
        )
    )

    temporary_profile = not options.user_data_dir
    user_data_dir = (
        create_temporary_user_data_dir()
        if temporary_profile
        else prepare_user_data_dir(str(options.user_data_dir))
    )
    child_env = browser_environment(options.restrictions, options.env)

    try:
        launched = await _spawn_on_free_port(
            options,
            executable_path=executable_path,
            user_data_dir=user_data_dir,
            env=child_env,
            reserve_port=reserve_port,
            spawn_browser=spawn_browser,
            wait_for_endpoint=wait_for_endpoint,
        )
    except BaseException:
        if temporary_profile:
            await _remove_profile(user_data_dir)
        raise
    browser_process = launched.browser_process
    once = getattr(browser_process, "once", None)
    if temporary_profile and callable(once):
        # The profile goes away with the browser, also when the user closes the
        # window instead of the caller calling close().
        def remove_on_exit(_code: Any = None) -> None:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                _remove_quietly(user_data_dir)
                return
            loop.run_in_executor(None, _remove_quietly, user_data_dir)

        once("exit", remove_on_exit)

    try:
        connection = await _resolve(
            connect(
                ConnectOptions(
                    engine=options.engine,
                    cdp_endpoint=launched.cdp_endpoint,
                    slow_mo=options.slow_mo,
                    timeout=options.timeout,
                    headers=options.headers,
                    seed_cookies=options.seed_cookies,
                    verbose=options.verbose,
                    downloads=options.downloads,
                )
            )
        )
        close = _create_closer(
            engine=options.engine,
            browser=connection.browser,
            browser_process=browser_process,
            user_data_dir=user_data_dir,
            temporary_profile=temporary_profile,
            close_timeout=options.close_timeout,
        )
    except BaseException:
        _kill(browser_process)
        await _wait_for_exit(browser_process, options.close_timeout)
        if temporary_profile:
            await _remove_profile(user_data_dir)
        raise

    return RealBrowserResult(
        browser=connection.browser,
        page=connection.page,
        downloads=connection.downloads,
        close=close,
        browser_process=browser_process,
        cdp_endpoint=launched.cdp_endpoint,
        remote_debugging_port=launched.port,
        executable_path=executable_path,
        user_data_dir=user_data_dir,
        temporary_profile=temporary_profile,
        args=launched.args,
    )
