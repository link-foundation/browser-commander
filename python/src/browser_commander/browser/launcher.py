"""Browser launcher for browser-commander.

By default (``launch="real"``) Browser Commander starts the installed Chrome
itself, exactly like a person who wants to attach a debugger would:
``--user-data-dir=<fresh temporary profile> --remote-debugging-port=<reserved
port>`` and nothing else, then attaches the engine over CDP (issues #101 and
#103). The profile is deleted on close. Every restriction the library used to
add silently is an explicit opt-in through ``restrictions``.

``launch="engine"`` keeps the Playwright/Selenium-launched browser for CI and
headless use; the switches those engines add are listed in limitations.json
(``engine-launch-switches``).
"""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal

from browser_commander.browser.profile_directory import (
    create_temporary_user_data_dir,
    remove_user_data_dir,
)
from browser_commander.browser.restrictions import (
    assert_string_array,
    browser_environment,
    merge_feature_switches,
    resolve_restrictions,
)
from browser_commander.core.engine_detection import EngineType
from browser_commander.downloads.attach import attach_downloads
from browser_commander.fingerprint.apply import apply_fingerprint
from browser_commander.fingerprint.automation_parity import (
    apply_automation_parity_args,
    parity_ignored_default_args,
)

ColorScheme = Literal["light", "dark", "no-preference"]
LaunchMode = Literal["real", "engine"]

#: How :func:`launch_browser` starts the browser (issue #103).
LAUNCH_MODES: tuple[str, ...] = ("real", "engine")


@dataclass
class LaunchOptions:
    """Browser launch configuration options."""

    engine: EngineType = "playwright"
    launch: LaunchMode = "real"
    """Who starts the browser: ``"real"`` - Browser Commander, with a
    hand-started command line - or ``"engine"`` - Playwright/Selenium."""
    user_data_dir: str | None = None
    """Persistent profile directory. When omitted a fresh temporary profile is
    created and deleted on close."""
    default_browser_check: bool | None = None
    first_run: bool = False
    preferences: Mapping[str, Any] | None = None
    local_state: Mapping[str, Any] | None = None
    headless: bool = False
    slow_mo: int = 0
    verbose: bool = False
    restrictions: list[str] = field(default_factory=list)
    """Opt-in restrictions from ``launch-restrictions.json``, such as
    ``"no-extensions"`` or the ``"legacy-defaults"`` preset."""
    args: list[str] = field(default_factory=list)
    extra_args: list[str] = field(default_factory=list)
    ignore_default_args: bool | list[str] = field(default_factory=list)
    """Engine default switches to omit, or ``True`` for all (``"engine"``
    launch only)."""
    env: Mapping[str, str] | None = None
    """Extra environment for the browser process only."""
    channel: str | None = None
    """Installed browser channel, such as ``"chrome"``, ``"msedge"``,
    ``"brave"`` or ``"chromium"``."""
    executable_path: str | None = None
    remote_debugging_port: int | None = None
    """Fixed CDP port for the real launch; a free one is reserved when omitted."""
    color_scheme: ColorScheme | None = None
    automation_parity: bool = True
    """Keep ``navigator.webdriver`` false where a launch switch would turn it
    on (headless or engine launches)."""
    fingerprint: Mapping[str, Any] | None = None
    """Environment fields to present to pages: user agent, timezone, locale,
    core count, screen and the rest. Applied over CDP after launch; see
    ``browser_commander.fingerprint.profile`` for the field list and ``presets``
    for ready-made profiles."""
    downloads: bool | Mapping[str, Any] | None = None
    """Manage downloads: ``True`` for defaults, or a mapping with ``directory``,
    ``persist`` and ``conflict``. The directory may be an absolute path,
    ``'user-downloads'`` or ``'temporary'``."""


@dataclass
class LaunchResult:
    """Result of a browser launch or connection.

    ``browser`` and ``page`` keep their historical meaning (a Playwright
    ``BrowserContext`` for a Playwright launch, the driver for Selenium); the
    other fields describe how the browser was started.
    """

    browser: Any
    page: Any
    #: The managed download lifecycle, when ``downloads`` was requested.
    downloads: Any = None
    #: ``await close()`` shuts the browser down and deletes a temporary profile.
    close: Callable[..., Any] | None = None
    #: ``"real"`` or ``"engine"`` for :func:`launch_browser`.
    launch: str | None = None
    user_data_dir: str | None = None
    temporary_profile: bool = False
    #: The browser switches Browser Commander passed.
    args: list[str] = field(default_factory=list)
    #: The CDP-connected Playwright ``Browser`` behind a real launch.
    connected_browser: Any = None
    browser_process: Any = None
    cdp_endpoint: str | None = None
    remote_debugging_port: int | None = None
    executable_path: str | None = None


def resolve_chrome_args(
    *,
    args: list[str] | None = None,
    extra_args: list[str] | None = None,
    ignore_default_args: bool | list[str] | None = None,
    restrictions: list[str] | None = None,
) -> list[str]:
    """Resolve the switches Browser Commander adds: restrictions, then args.

    Nothing is added by default (issue #103); :data:`CHROME_ARGS` is kept only
    as the ``legacy-defaults`` restriction preset. Repeated feature-list
    switches are merged. ``ignore_default_args`` names engine defaults and is
    handled by :func:`resolve_ignored_default_args`; it is accepted here for
    backward compatibility.
    """

    del ignore_default_args
    return merge_feature_switches(
        [
            *resolve_restrictions(restrictions).args,
            *assert_string_array([] if args is None else args, "args"),
            *assert_string_array(
                [] if extra_args is None else extra_args, "extra_args"
            ),
        ]
    )


def resolve_ignored_default_args(
    engine: EngineType,
    *,
    ignore_default_args: bool | list[str] | None = None,
    headless: bool = False,
    automation_parity: bool = True,
) -> bool | list[str]:
    """Merge the caller's exclusions with the ones parity needs.

    Playwright appends its own switches after the caller's ``args``, so a
    switch the engine adds cannot be countered by passing a different value --
    it has to be excluded at launch. See
    ``browser_commander.fingerprint.automation_parity``.
    """

    if ignore_default_args is True:
        return True
    requested = list(ignore_default_args or [])
    parity = (
        parity_ignored_default_args(engine, headless=headless)
        if automation_parity and engine in ("playwright", "selenium")
        else []
    )
    return list(dict.fromkeys([*parity, *requested]))


def selenium_excluded_switches(ignored: bool | list[str]) -> list[str]:
    """Translate switch names into the form ChromeDriver's excludeSwitches wants.

    ChromeDriver matches on the bare switch name, so ``--enable-automation``
    has to be passed as ``enable-automation``, and a switch carrying a value is
    matched by its name alone.
    """

    if ignored is True or not ignored:
        return []
    names = [argument.lstrip("-").split("=", 1)[0] for argument in ignored]
    return list(dict.fromkeys(name for name in names if name))


async def _resolve(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


def _is_executable(file: str | None) -> bool:
    return bool(file) and Path(str(file)).is_file() and os.access(str(file), os.X_OK)


async def _bundled_executable(engine: str) -> str | None:
    if engine != "playwright":
        return None
    from playwright.async_api import async_playwright

    async with async_playwright() as playwright:
        return str(playwright.chromium.executable_path)


async def resolve_launch_executable(
    *,
    engine: EngineType,
    channel: str | None = None,
    executable_path: str | None = None,
    resolve_system: Any = None,
    bundled_executable: Any = None,
) -> str:
    """Pick the browser binary for a real launch.

    An explicit ``executable_path`` or ``channel`` is honoured as given.
    Without either, the installed Google Chrome is preferred - it is the
    browser a person would start - and Playwright's downloaded Chromium is the
    fallback, so a machine with only ``playwright install chromium`` still
    works. The binary is spawned by Browser Commander either way, with the same
    clean command line.
    """

    if resolve_system is None:
        from browser_commander.browser.system_browser import (
            resolve_system_browser_executable as resolve_system,
        )
    if executable_path is not None or channel is not None:
        return str(
            await _resolve(
                resolve_system(
                    channel=channel or "chrome", executable_path=executable_path
                )
            )
        )
    try:
        return str(
            await _resolve(resolve_system(channel="chrome", executable_path=None))
        )
    except (FileNotFoundError, OSError) as error:
        try:
            bundled = await _resolve(
                (bundled_executable or _bundled_executable)(engine)
            )
        except Exception:
            bundled = None
        if bundled and _is_executable(str(bundled)):
            return str(bundled)
        raise error


def _validate_launch_options(options: LaunchOptions) -> None:
    if options.engine not in ("playwright", "selenium"):
        msg = f"Invalid engine: {options.engine}. Expected 'playwright' or 'selenium'"
        raise ValueError(msg)
    if options.launch not in LAUNCH_MODES:
        msg = f"Invalid launch mode: {options.launch}. Expected 'real' or 'engine'"
        raise ValueError(msg)
    # Validate arguments before anything is started or written to disk.
    resolve_chrome_args(
        args=options.args,
        extra_args=options.extra_args,
        restrictions=options.restrictions,
    )


async def _launch_real(
    options: LaunchOptions, dependencies: Mapping[str, Any]
) -> LaunchResult:
    from browser_commander.browser.real_browser import (
        RealBrowserOptions,
        launch_real_browser,
    )

    executable_path = await resolve_launch_executable(
        engine=options.engine,
        channel=options.channel,
        executable_path=options.executable_path,
        resolve_system=dependencies.get("resolve_system"),
        bundled_executable=dependencies.get("bundled_executable"),
    )
    launch_real = dependencies.get("launch_real_browser") or launch_real_browser
    session = await _resolve(
        launch_real(
            RealBrowserOptions(
                engine=options.engine,
                channel=options.channel or "chrome",
                executable_path=executable_path,
                user_data_dir=options.user_data_dir,
                default_browser_check=options.default_browser_check,
                first_run=options.first_run,
                preferences=options.preferences,
                local_state=options.local_state,
                remote_debugging_port=options.remote_debugging_port,
                headless=options.headless,
                restrictions=list(options.restrictions),
                args=list(options.args),
                extra_args=list(options.extra_args),
                env=options.env,
                automation_parity=options.automation_parity,
                slow_mo=options.slow_mo or None,
                verbose=options.verbose,
            )
        )
    )
    connected = session.browser
    browser = connected
    if options.engine == "playwright":
        # Playwright's persistent-context launch returned a BrowserContext, so
        # the real launch returns the attached default context the same way;
        # closing it closes the browser this call started.
        browser = connected.contexts[0]
        with contextlib.suppress(AttributeError, TypeError):
            browser.close = session.close
    return LaunchResult(
        browser=browser,
        page=session.page,
        close=session.close,
        launch="real",
        user_data_dir=session.user_data_dir,
        temporary_profile=session.temporary_profile,
        args=list(session.args),
        connected_browser=connected,
        browser_process=session.browser_process,
        cdp_endpoint=session.cdp_endpoint,
        remote_debugging_port=session.remote_debugging_port,
        executable_path=session.executable_path,
    )


async def _default_start_playwright() -> Any:
    from playwright.async_api import async_playwright

    return await async_playwright().start()


def _default_create_selenium(chrome_options: Any, service_env: Any) -> Any:
    from selenium import webdriver
    from selenium.webdriver.chrome.service import Service

    service = Service(env=service_env) if service_env is not None else Service()
    return webdriver.Chrome(service=service, options=chrome_options)


def _selenium_options(
    options: LaunchOptions,
    chrome_args: list[str],
    user_data_dir: str,
    ignored: bool | list[str],
) -> Any:
    from selenium.webdriver.chrome.options import Options

    chrome_options = Options()
    if options.headless:
        chrome_options.add_argument("--headless=new")
    for argument in chrome_args:
        chrome_options.add_argument(argument)
    chrome_options.add_argument(f"--user-data-dir={user_data_dir}")
    if options.executable_path is not None or options.channel is not None:
        from browser_commander.browser.system_browser import (
            resolve_system_browser_executable,
        )

        chrome_options.binary_location = resolve_system_browser_executable(
            channel=options.channel or "chrome",
            executable_path=options.executable_path,
        )
    # ChromeDriver names its own switches without the leading dashes.
    excluded = selenium_excluded_switches(ignored)
    if excluded:
        chrome_options.add_experimental_option("excludeSwitches", excluded)
    return chrome_options


async def _launch_with_engine(
    options: LaunchOptions, dependencies: Mapping[str, Any]
) -> LaunchResult:
    engine = options.engine
    chrome_args = resolve_chrome_args(
        args=options.args,
        extra_args=options.extra_args,
        restrictions=options.restrictions,
    )
    if options.automation_parity:
        chrome_args = apply_automation_parity_args(chrome_args)
    ignored = resolve_ignored_default_args(
        engine,
        ignore_default_args=options.ignore_default_args,
        headless=options.headless,
        automation_parity=options.automation_parity,
    )
    child_env = browser_environment(options.restrictions, options.env)
    temporary_profile = not options.user_data_dir
    user_data_dir = (
        create_temporary_user_data_dir()
        if temporary_profile
        else str(options.user_data_dir)
    )

    browser: Any = None
    playwright: Any = None
    try:
        if engine == "playwright":
            start_playwright = (
                dependencies.get("start_playwright") or _default_start_playwright
            )
            playwright = await _resolve(start_playwright())
            context_options: dict[str, Any] = {
                "headless": options.headless,
                "slow_mo": options.slow_mo,
                "chromium_sandbox": True,
                "viewport": None,
                "args": chrome_args,
                "ignore_default_args": ignored,
            }
            # Playwright applies color_scheme as a context-level launch option.
            if options.color_scheme is not None:
                context_options["color_scheme"] = options.color_scheme
            if options.channel is not None:
                context_options["channel"] = options.channel
            if options.executable_path is not None:
                context_options["executable_path"] = options.executable_path
            if child_env is not None:
                context_options["env"] = child_env
            browser = await playwright.chromium.launch_persistent_context(
                user_data_dir, **context_options
            )
            pages = browser.pages
            page = pages[0] if pages else await browser.new_page()
        else:
            create_selenium = (
                dependencies.get("create_selenium") or _default_create_selenium
            )
            chrome_options = _selenium_options(
                options, chrome_args, user_data_dir, ignored
            )
            browser = await _resolve(create_selenium(chrome_options, child_env))
            page = browser  # In Selenium, the driver is both browser and page
    except BaseException:
        await _close_engine_browser(engine, browser, playwright, None)
        if temporary_profile:
            await asyncio.to_thread(_remove_quietly, user_data_dir)
        raise

    original_close = getattr(browser, "close", None) if engine == "playwright" else None
    closing: asyncio.Future[None] | None = None

    async def shut_down() -> None:
        await _close_engine_browser(engine, browser, playwright, original_close)
        if temporary_profile:
            await asyncio.to_thread(_remove_quietly, user_data_dir)

    async def close(*_args: Any, **_kwargs: Any) -> None:
        nonlocal closing
        if closing is None:
            closing = asyncio.ensure_future(shut_down())
        await asyncio.shield(closing)

    if engine == "playwright":
        with contextlib.suppress(AttributeError, TypeError):
            browser.close = close
    return LaunchResult(
        browser=browser,
        page=page,
        close=close,
        launch="engine",
        user_data_dir=user_data_dir,
        temporary_profile=temporary_profile,
        args=chrome_args,
    )


def _remove_quietly(user_data_dir: str) -> None:
    with contextlib.suppress(OSError):
        remove_user_data_dir(user_data_dir)


async def _close_engine_browser(
    engine: str, browser: Any, playwright: Any, original_close: Any
) -> None:
    if engine == "playwright":
        close = original_close or getattr(browser, "close", None)
        if close is not None:
            with contextlib.suppress(Exception):
                await _resolve(close())
        if playwright is not None:
            with contextlib.suppress(Exception):
                await _resolve(playwright.stop())
    elif browser is not None:
        with contextlib.suppress(Exception):
            await asyncio.to_thread(browser.quit)


async def _unfocus_address_bar(
    page: Any, engine: str, verbose: bool, settle: float
) -> None:
    # Bringing the page to front moves focus from the address bar to the page.
    try:
        await asyncio.sleep(settle)
        if engine == "playwright":
            await page.bring_to_front()
        if verbose:
            print("Address bar unfocused automatically")
    except Exception as error:
        if verbose:
            print(f"Could not unfocus address bar: {error}")


async def launch_browser(options: LaunchOptions | None = None) -> LaunchResult:
    """Launch a browser.

    By default (``launch="real"``) the installed Chrome is started with only
    ``--user-data-dir=<fresh temporary profile>`` and
    ``--remote-debugging-port=<reserved port>`` and the engine attaches over
    CDP, so ``navigator.webdriver`` is false. ``launch="engine"`` lets
    Playwright or Selenium start the browser instead.

    Args:
        options: Launch configuration options

    Returns:
        LaunchResult with the browser (a ``BrowserContext`` for Playwright),
        page, download manager, ``close`` and launch metadata.

    Raises:
        ValueError: If the engine, launch mode or a restriction is invalid
    """

    return await launch_browser_with_dependencies(options or LaunchOptions())


async def launch_browser_with_dependencies(
    options: LaunchOptions,
    dependencies: Mapping[str, Any] | None = None,
) -> LaunchResult:
    """Dependency-injected implementation used by :func:`launch_browser` and tests.

    Recognised dependencies: ``launch_real_browser``, ``resolve_system``,
    ``bundled_executable``, ``start_playwright``, ``create_selenium`` and
    ``settle_seconds``.
    """

    dependencies = dependencies or {}
    _validate_launch_options(options)
    engine = options.engine
    verbose = options.verbose

    if verbose:
        print(f"Launching browser with {engine} engine ({options.launch})...")

    launched = (
        await _launch_with_engine(options, dependencies)
        if options.launch == "engine"
        else await _launch_real(options, dependencies)
    )
    browser = launched.browser
    page = launched.page

    if verbose:
        print(f"Browser launched with {engine} engine")

    try:
        # A Playwright-launched context applies color_scheme itself; an
        # attached browser and Selenium need page-level emulation.
        emulate_color_scheme = options.color_scheme is not None and (
            options.launch == "real" or engine == "selenium"
        )
        if emulate_color_scheme:
            try:
                from browser_commander.browser.media import emulate_media

                await emulate_media(
                    page=page, engine=engine, color_scheme=options.color_scheme
                )
                if verbose:
                    print(f'Color scheme set to "{options.color_scheme}"')
            except Exception as error:
                if verbose:
                    print(f"Could not set color scheme: {error}")

        # The fingerprint is applied before the caller can navigate, so the
        # first document a page loads already sees the configured environment.
        if options.fingerprint is not None:
            await apply_fingerprint(
                page=page, browser=browser, engine=engine, profile=options.fingerprint
            )
            if verbose:
                print("Fingerprint profile applied")

        await _unfocus_address_bar(
            page, engine, verbose, float(dependencies.get("settle_seconds", 0.5))
        )

        # Downloads are armed before the caller can navigate: a download
        # triggered by the first page load still lands in the managed directory.
        launched.downloads = await attach_downloads(
            engine=engine,
            browser=browser,
            page=page,
            downloads=options.downloads,
        )
    except BaseException:
        if launched.close is not None:
            await launched.close()
        raise
    return launched
