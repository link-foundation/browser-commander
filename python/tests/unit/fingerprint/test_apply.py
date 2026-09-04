"""Tests for applying a fingerprint profile to a page.

These mirror ``js/tests/unit/fingerprint/apply.test.js``, with the Puppeteer
half replaced by Selenium, which is the second engine this package supports.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

from browser_commander.fingerprint.apply import (
    SeleniumCdpSession,
    apply_fingerprint,
    create_cdp_session,
)
from browser_commander.fingerprint.presets import create_fingerprint_preset


class RecordingSession:
    """A CDP session that records what was sent instead of talking to Chrome."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, dict[str, Any]]] = []

    async def send(self, method: str, params: Any = None) -> dict[str, Any]:
        self.sent.append((method, dict(params or {})))
        return {}

    def methods(self) -> list[str]:
        return [method for method, _ in self.sent]


class PlaywrightBrowserDouble:
    """A stand-in for the Playwright context ``launch_browser`` hands back."""

    def __init__(self, session: RecordingSession) -> None:
        self.session = session
        self.cdp_targets: list[Any] = []
        self.listeners: dict[str, Any] = {}

    async def new_cdp_session(self, target: Any) -> RecordingSession:
        self.cdp_targets.append(target)
        return self.session

    def on(self, event: str, handler: Any) -> None:
        self.listeners[event] = handler

    def emit(self, event: str, argument: Any) -> None:
        self.listeners[event](argument)


class SeleniumDriverDouble:
    """A stand-in for the Selenium driver, which is its own CDP transport."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, dict[str, Any]]] = []

    def execute_cdp_cmd(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        self.sent.append((method, params))
        return {}


def playwright_double() -> tuple[PlaywrightBrowserDouble, Any, RecordingSession]:
    session = RecordingSession()
    browser = PlaywrightBrowserDouble(session)
    page = object()
    return browser, page, session


PROFILE = create_fingerprint_preset("windows-chrome")


async def drain() -> None:
    """Let the tasks a new-page handler started run to completion."""
    await asyncio.sleep(0)
    await asyncio.sleep(0)


async def test_opens_the_session_on_the_context_launch_browser_hands_back() -> None:
    browser, page, session = playwright_double()

    assert await create_cdp_session(page=page, browser=browser) is session
    assert browser.cdp_targets == [page]


async def test_falls_back_to_the_context_of_the_page() -> None:
    session = RecordingSession()
    context = PlaywrightBrowserDouble(session)

    page = SimpleNamespace(context=context)

    assert await create_cdp_session(page=page, browser=object()) is session
    assert context.cdp_targets == [page]


async def test_wraps_the_selenium_driver_instead_of_opening_a_session() -> None:
    driver = SeleniumDriverDouble()

    session = await create_cdp_session(page=driver, engine="selenium")

    assert isinstance(session, SeleniumCdpSession)
    await session.send("Emulation.setTimezoneOverride", {"timezoneId": "UTC"})
    assert driver.sent == [
        ("Emulation.setTimezoneOverride", {"timezoneId": "UTC"}),
    ]


async def test_requires_a_page() -> None:
    with pytest.raises(TypeError, match="requires a page"):
        await apply_fingerprint(page=None, profile=PROFILE)


async def test_sends_the_emulation_commands_before_installing_the_script() -> None:
    browser, page, session = playwright_double()

    await apply_fingerprint(page=page, browser=browser, profile=PROFILE)

    methods = session.methods()
    first_script_index = methods.index("Page.enable")
    assert first_script_index > 0
    assert all(
        method.startswith("Emulation.") for method in methods[:first_script_index]
    )


async def test_enables_the_page_domain_then_patches_the_open_document() -> None:
    browser, page, session = playwright_double()

    await apply_fingerprint(page=page, browser=browser, profile=PROFILE)

    # Measured: without Page.enable, Chrome accepts
    # addScriptToEvaluateOnNewDocument and never runs the script.
    assert [
        method for method in session.methods() if not method.startswith("Emulation.")
    ] == [
        "Page.enable",
        "Page.addScriptToEvaluateOnNewDocument",
        "Runtime.evaluate",
    ]
    (_, added), (_, evaluated) = session.sent[-2:]
    assert added["source"] == evaluated["expression"]
    assert evaluated["returnByValue"] is True


async def test_normalizes_a_raw_profile_and_reports_what_it_sent() -> None:
    browser, page, session = playwright_double()

    applied = await apply_fingerprint(
        page=page,
        browser=browser,
        profile={"timezoneId": "Europe/Berlin", "deviceMemory": 8},
    )

    assert applied.profile["timezoneId"] == "Europe/Berlin"
    assert [(command.method, command.params) for command in applied.commands] == [
        ("Emulation.setTimezoneOverride", {"timezoneId": "Europe/Berlin"}),
    ]
    assert applied.init_script is not None
    assert "deviceMemory" in applied.init_script
    assert session.methods()[0] == "Emulation.setTimezoneOverride"


async def test_rejects_a_raw_profile_with_an_unknown_field() -> None:
    browser, page, _ = playwright_double()

    with pytest.raises(ValueError, match="cpuModel"):
        await apply_fingerprint(page=page, browser=browser, profile={"cpuModel": "M3"})


async def test_skips_the_script_commands_when_the_browser_covers_everything() -> None:
    browser, page, session = playwright_double()

    applied = await apply_fingerprint(
        page=page, browser=browser, profile={"timezoneId": "UTC"}
    )

    assert applied.init_script is None
    assert session.methods() == ["Emulation.setTimezoneOverride"]


async def test_applies_the_same_profile_to_a_page_opened_later() -> None:
    browser, page, session = playwright_double()

    await apply_fingerprint(page=page, browser=browser, profile=PROFILE)
    before = len(session.sent)
    later_page = object()
    browser.emit("page", later_page)
    await drain()

    assert len(session.sent) == before * 2
    assert browser.cdp_targets == [page, later_page]


async def test_survives_a_page_that_closes_before_its_session_is_ready() -> None:
    browser, page, _ = playwright_double()

    await apply_fingerprint(page=page, browser=browser, profile=PROFILE)

    async def closed(_target: Any) -> RecordingSession:
        raise RuntimeError("Target closed")

    browser.new_cdp_session = closed  # type: ignore[method-assign]
    browser.emit("page", object())
    await drain()


async def test_does_not_hook_new_pages_when_asked_not_to() -> None:
    browser, page, _ = playwright_double()

    await apply_fingerprint(
        page=page, browser=browser, profile=PROFILE, apply_to_new_pages=False
    )

    assert browser.listeners == {}


async def test_drives_selenium_through_the_driver_itself() -> None:
    driver = SeleniumDriverDouble()

    applied = await apply_fingerprint(
        page=driver, engine="selenium", profile=PROFILE, patch_webdriver=True
    )

    methods = [method for method, _ in driver.sent]
    assert methods[0] == "Emulation.setUserAgentOverride"
    assert methods[-3:] == [
        "Page.enable",
        "Page.addScriptToEvaluateOnNewDocument",
        "Runtime.evaluate",
    ]
    assert applied.init_script is not None
    assert '"webdriver":false' in applied.init_script
