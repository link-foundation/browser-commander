"""Browser-assisted cookie reads and explicit live session validation."""

import asyncio
import os
import shutil
import sys
from dataclasses import asdict, replace
from pathlib import Path

from browser_commander.browser.browser_profiles import (
    resolve_browser_profile,
    resolve_source_browser,
)
from browser_commander.browser.browser_sources import browser_family
from browser_commander.browser.migration.domains import matches_domains
from browser_commander.browser.real_browser import RealBrowserOptions
from browser_commander.browser.session_cookies import set_cookies
from browser_commander.browser.snapshot import (
    SnapshotOptions,
    launch_snapshot,
    snapshot_user_data_dir,
)
from browser_commander.browser.storage_state import save_storage_state


async def read_browser_cookie_session(
    options, *, launch_options=None, launch=launch_snapshot
) -> list[dict]:
    browser = resolve_source_browser(options.browser)
    if browser_family(browser) != "chromium":
        raise ValueError(
            "browser-backed cookie reading requires Chromium; select via=database for Firefox or Safari"
        )
    profile = (
        Path(options.profile_dir)
        if options.profile_dir
        else resolve_browser_profile(
            browser,
            options.profile,
            platform=sys.platform,
            home_dir=Path.home(),
            environment=os.environ,
        ).path
    )
    settings = launch_options or RealBrowserOptions(channel=browser)
    result = await launch(
        SnapshotOptions(
            browser=browser,
            profile=profile.name,
            user_data_dir=str(profile.parent),
            include=["cookies"],
        ),
        settings,
    )
    try:
        state = await save_storage_state(settings.engine, result.browser, result.page)
        return [
            cookie
            for cookie in state["cookies"]
            if matches_domains(
                cookie["domain"],
                [options.domain_filter] if options.domain_filter else [],
            )
        ]
    finally:
        await result.close()


async def find_site_sessions(
    *,
    domains: list[str],
    sources=None,
    profiles=None,
    is_logged_in=None,
    launch_options=None,
    launch=launch_snapshot,
) -> list[dict]:
    if not domains:
        raise ValueError("find_site_sessions requires domains")
    if sources is None:
        from browser_commander.browser.browser_cookies import list_cookie_sources

        sources = [
            asdict(source)
            for source in await asyncio.to_thread(list_cookie_sources, domains=domains)
        ]
    results = []
    for source in [*sources, *(profiles or [])]:
        result = None
        snapshot = None
        source = dict(source)
        path = Path(source["path"])
        try:
            settings = replace(
                launch_options or RealBrowserOptions(channel=source["browser"]),
                engine=source.get(
                    "engine", (launch_options or RealBrowserOptions()).engine
                ),
            )
            if browser_family(source["browser"]) != "chromium":
                from browser_commander.browser.browser_cookies import (
                    BrowserCookieReadOptions,
                    read_browser_cookies,
                )

                cookies = [
                    cookie
                    for cookie in await asyncio.to_thread(
                        read_browser_cookies,
                        BrowserCookieReadOptions(
                            browser=source["browser"],
                            profile_dir=path,
                            via="database",
                            cache=False,
                        ),
                    )
                    if matches_domains(cookie["domain"], domains)
                ]
                logged_in = None
                if is_logged_in:
                    from browser_commander.browser.launcher import (
                        LaunchOptions,
                        launch_browser,
                    )

                    result = await launch_browser(
                        LaunchOptions(
                            **{
                                "headless": settings.headless,
                                "executable_path": settings.executable_path,
                                "args": list(settings.args),
                                **source.get("launch_options", {}),
                                "engine": settings.engine,
                                "launch": "engine",
                                "user_data_dir": None,
                                "persist_session_cookies": False,
                            }
                        )
                    )
                    await set_cookies(result.page, settings.engine, cookies)
                    logged_in = bool(await is_logged_in(result, source, cookies))
                results.append({**source, "cookies": cookies, "logged_in": logged_in})
                continue
            if source.get("launch") == "engine":
                from browser_commander.browser.launcher import (
                    LaunchOptions,
                    launch_browser,
                )

                snapshot = await asyncio.to_thread(
                    snapshot_user_data_dir,
                    browser=source["browser"],
                    profile=path.name,
                    user_data_dir=path.parent,
                    include=["cookies"],
                )
                engine_options = {
                    "headless": settings.headless,
                    "executable_path": settings.executable_path,
                    "args": list(settings.args),
                    **source.get("launch_options", {}),
                }
                engine_options.update(
                    engine=settings.engine,
                    launch="engine",
                    user_data_dir=str(snapshot["target"]),
                )
                engine_options["args"] = [
                    *engine_options.get("args", settings.args),
                    f"--profile-directory={path.name}",
                ]
                result = await launch_browser(LaunchOptions(**engine_options))
            else:
                result = await launch(
                    SnapshotOptions(
                        browser=source["browser"],
                        profile=path.name,
                        user_data_dir=str(path.parent),
                        include=["cookies"],
                    ),
                    settings,
                )
            state = await save_storage_state(
                settings.engine, result.browser, result.page
            )
            cookies = [
                cookie
                for cookie in state["cookies"]
                if matches_domains(cookie["domain"], domains)
            ]
            logged_in = (
                bool(await is_logged_in(result, source, cookies))
                if is_logged_in
                else None
            )
            results.append({**source, "cookies": cookies, "logged_in": logged_in})
        except Exception as error:
            results.append(
                {**source, "cookies": [], "logged_in": None, "error": str(error)}
            )
        finally:
            try:
                if result:
                    await result.close()
            except Exception as error:
                results[-1]["error"] = str(error)
            finally:
                if snapshot:
                    try:
                        shutil.rmtree(snapshot["target"])
                    except OSError as error:
                        results[-1]["error"] = str(error)
    return results
