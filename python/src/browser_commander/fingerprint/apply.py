"""Apply a fingerprint profile to a live page.

Everything goes through CDP, including the init script, so the same code path
works for Playwright and Selenium and behaves identically in both. The
alternative -- Playwright's ``add_init_script`` on one engine and raw CDP on the
other -- would give the two engines different injection timing, which is exactly
the kind of difference this module exists to remove.

Selenium's ``execute_cdp_cmd`` talks to the window the driver currently owns and
it is blocking, so it is wrapped in a session object with the same ``send``
shape Playwright hands out. Selenium also has no "a page was opened" event, so
``apply_to_new_pages`` is a Playwright-only feature; on Selenium a new tab has to
be given the profile explicitly.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from browser_commander.fingerprint.cdp_overrides import (
    CdpCommand,
    build_cdp_emulation_commands,
)
from browser_commander.fingerprint.init_script import build_fingerprint_init_script
from browser_commander.fingerprint.profile import resolve_fingerprint_profile


@dataclass(frozen=True)
class AppliedFingerprint:
    """What :func:`apply_fingerprint` resolved and sent."""

    profile: dict[str, Any]
    commands: list[CdpCommand]
    init_script: str | None = None


@dataclass
class SeleniumCdpSession:
    """Give Selenium's blocking ``execute_cdp_cmd`` the Playwright session shape."""

    driver: Any

    async def send(self, method: str, params: Mapping[str, Any] | None = None) -> Any:
        """Send one CDP command to the window the driver currently owns."""
        return self.driver.execute_cdp_cmd(method, dict(params or {}))


#: Tasks started for pages opened later, kept referenced so the event loop does
#: not garbage-collect them while they are still running.
_pending_page_tasks: set[asyncio.Task[Any]] = set()


async def create_cdp_session(
    *,
    page: Any,
    browser: Any = None,
    engine: str = "playwright",
) -> Any:
    """Open a CDP session for a page, whichever engine owns it."""
    if engine == "selenium":
        return SeleniumCdpSession(page)
    # Playwright exposes new_cdp_session on the browser context; a persistent
    # context is what launch_browser hands back as the browser.
    context = browser if hasattr(browser, "new_cdp_session") else page.context
    return await context.new_cdp_session(page)


async def _apply_to_page(
    *,
    page: Any,
    browser: Any,
    engine: str,
    commands: list[CdpCommand],
    init_script: str | None,
) -> Any:
    session = await create_cdp_session(page=page, browser=browser, engine=engine)
    for command in commands:
        await session.send(command.method, command.params)
    if init_script:
        # Measured: without Page.enable on this session, Chrome accepts
        # addScriptToEvaluateOnNewDocument and returns an identifier, but never
        # runs the script on any subsequent document. Enabling the domain is
        # what makes the instrumentation take effect.
        await session.send("Page.enable")
        await session.send(
            "Page.addScriptToEvaluateOnNewDocument", {"source": init_script}
        )
        # A page that has already navigated will not replay the init script, so
        # patch the current document too. The payload guards against running
        # twice, which makes this safe on a brand new about:blank as well.
        await session.send(
            "Runtime.evaluate", {"expression": init_script, "returnByValue": True}
        )
    return session


def _hook_new_pages(
    *,
    browser: Any,
    engine: str,
    commands: list[CdpCommand],
    init_script: str | None,
) -> None:
    async def attach(new_page: Any) -> None:
        try:
            await _apply_to_page(
                page=new_page,
                browser=browser,
                engine=engine,
                commands=commands,
                init_script=init_script,
            )
        except Exception:
            # A page can close before the session is established; losing the
            # overrides on a page that no longer exists is not an error.
            return

    def on_page(new_page: Any) -> None:
        task = asyncio.create_task(attach(new_page))
        _pending_page_tasks.add(task)
        task.add_done_callback(_pending_page_tasks.discard)

    browser.on("page", on_page)


async def apply_fingerprint(
    *,
    page: Any,
    profile: Mapping[str, Any],
    browser: Any = None,
    engine: str = "playwright",
    patch_webdriver: bool = False,
    apply_to_new_pages: bool = True,
) -> AppliedFingerprint:
    """Apply a fingerprint profile to a page and, optionally, to later pages.

    Args:
        page: Playwright page, or the Selenium driver.
        profile: Raw or already-normalized fingerprint profile.
        browser: Playwright context or browser, used to reach new pages.
        engine: ``'playwright'`` or ``'selenium'``.
        patch_webdriver: Force ``navigator.webdriver`` to ``False`` from
            JavaScript. Only needed when attaching to a browser somebody else
            launched with automation switches that can no longer be changed; a
            browser launched by this library does not need it, because
            ``--disable-blink-features=AutomationControlled`` already covers it.
        apply_to_new_pages: Also apply to pages opened later. Playwright only.

    Returns:
        The resolved profile, the commands that were sent and the init script.

    Raises:
        TypeError: If no page was given.
    """
    if page is None:
        msg = "apply_fingerprint requires a page"
        raise TypeError(msg)

    # Resolving is idempotent -- every derived field is also an accepted input
    # field -- so an already-resolved profile can be passed straight back in.
    resolved = resolve_fingerprint_profile(profile)
    commands = build_cdp_emulation_commands(resolved)
    init_script = build_fingerprint_init_script(
        resolved, patch_webdriver=patch_webdriver
    )

    await _apply_to_page(
        page=page,
        browser=browser,
        engine=engine,
        commands=commands,
        init_script=init_script,
    )

    if apply_to_new_pages and browser is not None and hasattr(browser, "on"):
        _hook_new_pages(
            browser=browser,
            engine=engine,
            commands=commands,
            init_script=init_script,
        )

    return AppliedFingerprint(
        profile=resolved, commands=commands, init_script=init_script
    )
