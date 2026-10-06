"""Native, isolated Safari sessions through Apple's W3C WebDriver."""

from __future__ import annotations

import asyncio
import contextlib
import os
import sys
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from browser_commander.browser.browser_sources import find_browser_source
from browser_commander.browser.storage_state import load_storage_state
from browser_commander.utilities.subprocess import run_command


def is_safari_channel(channel: str | None) -> bool:
    source = find_browser_source(channel)
    return source is not None and source["family"] == "safari"


class SafariUnsupportedError(NotImplementedError):
    """An operation Safari's classic WebDriver cannot perform."""

    code = "SAFARI_UNSUPPORTED"

    def __init__(self, feature: str):
        self.feature = feature
        super().__init__(f"{feature} is unsupported on safari")


class SafariSetupError(RuntimeError):
    """One-time authorization failure with an explicit settings opener."""

    code = "SAFARI_SETUP_REQUIRED"

    def __init__(self, cause: Exception, channel: str):
        self.channel = channel
        source = find_browser_source(channel)
        assert source is not None
        driver = source["executables"]["darwin"][0]
        super().__init__(
            f"Safari automation setup required: {cause}. In Safari → Settings → "
            'Advanced enable "Show features for web developers", then Develop → '
            f'"Allow Remote Automation". Run "{driver}" --enable once '
            "(an admin password may be required). Call error.open_settings() "
            "to open Safari's Advanced settings."
        )

    async def open_settings(self) -> Any:
        return await open_safari_settings(self.channel)


async def open_safari_settings(channel: str = "safari") -> Any:
    """Open Advanced settings only when explicitly requested."""
    if sys.platform != "darwin":
        raise SafariUnsupportedError("Safari settings outside macOS")
    source = find_browser_source(channel)
    app = (
        "Safari Technology Preview"
        if source and source["id"] == "safari-technology-preview"
        else "Safari"
    )
    return await run_command(
        "osascript",
        [
            "-e",
            f'tell application "{app}" to activate',
            "-e",
            f'tell application "{app}" to open location "x-safari-preferences:com.apple.Safari.preferences.Advanced"',
        ],
    )


def require_safari_feature(page: Any, feature: str) -> None:
    """Raise a typed error before attempting unsupported Safari operations."""
    capabilities = getattr(page, "capabilities", {})
    if isinstance(capabilities, Mapping) and str(
        capabilities.get("browserName", "")
    ).lower().startswith("safari"):
        raise SafariUnsupportedError(feature)


def validate_safari_options(options: Any) -> None:
    for name in (
        "headless",
        "user_data_dir",
        "migrate_from",
        "remote_debugging_port",
        "fingerprint",
        "color_scheme",
        "downloads",
        "preferences",
        "local_state",
        "default_browser_check",
        "first_run",
        "headers",
    ):
        value = getattr(options, name, None)
        if value is not None and value is not False:
            raise SafariUnsupportedError(name)
    for name in ("args", "extra_args", "restrictions"):
        if getattr(options, name, None):
            raise SafariUnsupportedError(name)


async def seed_safari_state(driver: Any, state: Mapping[str, Any]) -> None:
    """Visit each cookie domain, add cookies, and restore the original page."""

    def seed() -> None:
        previous = driver.current_url
        try:
            for raw in state.get("cookies", []):
                cookie = dict(raw)
                cookie_url = cookie.pop("url", None)
                domain = cookie.get("domain") or (
                    urlsplit(cookie_url).hostname if cookie_url else None
                )
                if not domain:
                    raise ValueError("Safari seed cookies require a domain or URL")
                origin = next(
                    (
                        item["origin"]
                        for item in state.get("origins", [])
                        if urlsplit(item["origin"]).hostname == domain.lstrip(".")
                    ),
                    None,
                )
                driver.get(
                    cookie_url
                    or origin
                    or f"{'https' if cookie.get('secure') else 'http'}://{domain.lstrip('.')}/"
                )
                expires = cookie.pop("expires", None)
                if expires is not None and expires > 0:
                    cookie["expiry"] = int(expires)
                cookie.setdefault("path", "/")
                driver.add_cookie(cookie)
            for entry in state.get("origins", []):
                driver.get(entry["origin"])
                driver.execute_script(
                    "for (const item of arguments[0]) localStorage.setItem(item.name, item.value)",
                    entry.get("localStorage", []),
                )
        finally:
            driver.get(previous)

    await asyncio.to_thread(seed)


def _create_safari(options: Any, driver_path: str) -> Any:
    from selenium import webdriver
    from selenium.webdriver.safari.options import Options
    from selenium.webdriver.safari.service import Service

    safari_options = Options()
    source = find_browser_source(options.channel)
    safari_options.use_technology_preview = bool(
        source and source["id"] == "safari-technology-preview"
    )
    with tempfile.TemporaryDirectory(prefix="browser-commander-safari-") as logs:
        output = Path(logs) / "safaridriver.log"
        service = Service(
            executable_path=driver_path,
            env={**os.environ, **(options.env or {})},
            log_output=str(output),
        )
        try:
            return webdriver.Safari(service=service, options=safari_options)
        except Exception as error:
            with contextlib.suppress(Exception):
                service.stop()
            with output.open("rb") as stream:
                stream.seek(0, 2)
                stream.seek(max(0, stream.tell() - 4000))
                details = stream.read().decode("utf-8", errors="replace").strip()
            if details:
                raise RuntimeError(f"{error}: {details}") from error
            raise


async def launch_safari(
    options: Any, dependencies: Mapping[str, Any] | None = None
) -> Any:
    """Launch headed Safari, then seed cookies through domain-scoped add_cookie."""
    from browser_commander.browser.real_browser import RealBrowserResult

    dependencies = dependencies or {}
    validate_safari_options(options)
    if dependencies.get("platform", sys.platform) != "darwin":
        raise SafariUnsupportedError("Safari launch outside macOS")
    source = find_browser_source(options.channel)
    assert source is not None
    driver_path = options.executable_path or source["executables"]["darwin"][0]
    create = dependencies.get("create_safari", _create_safari)
    try:
        driver = await asyncio.to_thread(create, options, driver_path)
    except Exception as error:
        message = str(error).lower()
        if (
            "allow remote automation" in message
            or "--enable" in message
            or "not authorized" in message
            or "remote automation is disabled" in message
        ):
            raise SafariSetupError(error, source["id"]) from error
        raise

    closing: asyncio.Task[None] | None = None

    async def close() -> None:
        nonlocal closing
        if closing is None:

            async def quit_driver() -> None:
                with contextlib.suppress(Exception):
                    await asyncio.to_thread(driver.quit)

            closing = asyncio.create_task(quit_driver())
        await asyncio.shield(closing)

    try:
        from browser_commander.browser.storage_state import restore_storage_state

        state = load_storage_state(options.storage_state) or {
            "cookies": [],
            "origins": [],
        }
        state["cookies"] = [*state["cookies"], *getattr(options, "seed_cookies", [])]
        await restore_storage_state("selenium", driver, driver, state)
    except BaseException:
        await close()
        raise
    return RealBrowserResult(
        browser=driver,
        page=driver,
        close=close,
        launch=getattr(options, "launch", "real"),
        executable_path=driver_path,
        temporary_profile=False,
    )
