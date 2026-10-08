"""Portable Playwright-shape cookie and localStorage state for Python engines."""

from __future__ import annotations

import json
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Union
from urllib.parse import urlsplit

StorageStateInput = Union[str, Path, Mapping[str, Any], None]


def load_storage_state(value: StorageStateInput) -> dict[str, Any] | None:
    """Read and validate a Playwright-compatible storage-state object or file."""

    if value is None:
        return None
    if isinstance(value, (str, Path)):
        state = json.loads(Path(value).read_text(encoding="utf-8"))
    else:
        state = value
    if not isinstance(state, Mapping):
        raise ValueError("storage_state must be a JSON object or path")
    cookies = state.get("cookies", [])
    origins = state.get("origins", [])
    if not isinstance(cookies, list) or not all(
        isinstance(cookie, Mapping) for cookie in cookies
    ):
        raise ValueError("storage_state.cookies must be a list of objects")
    if not isinstance(origins, list) or not all(
        isinstance(origin, Mapping)
        and isinstance(origin.get("origin"), str)
        and isinstance(origin.get("localStorage", []), list)
        for origin in origins
    ):
        raise ValueError(
            "storage_state.origins must contain origins and localStorage lists"
        )
    return {"cookies": list(cookies), "origins": list(origins)}


def _restore_script(origins: list[Mapping[str, Any]]) -> str:
    payload = json.dumps(origins, separators=(",", ":"))
    return (
        "(() => { const origins = "
        + payload
        + "; const entry = origins.find(item => item.origin === globalThis.location.origin);"
        " if (!entry) return; for (const item of entry.localStorage || [])"
        " globalThis.localStorage.setItem(item.name, item.value); })()"
    )


async def restore_storage_state(
    engine: str,
    browser: Any,
    page: Any,
    state: StorageStateInput,
) -> None:
    """Apply cookies and origin-scoped localStorage before caller navigation."""

    loaded = load_storage_state(state)
    if loaded is None:
        return
    cookies = loaded["cookies"]
    origins = loaded["origins"]
    if engine == "playwright":
        context = browser if hasattr(browser, "add_cookies") else page.context
        if cookies:
            from browser_commander.browser.session_cookies import (
                normalize_session_cookies,
            )

            await context.add_cookies(normalize_session_cookies(cookies, engine))
        if origins:
            script = _restore_script(origins)
            await context.add_init_script(script=script)
            await page.evaluate(script)
            for current in getattr(context, "pages", []):
                if current is not page:
                    await current.evaluate(script)
        return
    if engine == "selenium":
        if (
            str(getattr(browser, "capabilities", {}).get("browserName", ""))
            .lower()
            .startswith("safari")
        ):
            from browser_commander.browser.safari_webdriver import seed_safari_state

            await seed_safari_state(browser, loaded)
            return
        for cookie in cookies:
            from browser_commander.browser.session_cookies import (
                normalize_session_cookies,
            )

            browser.execute_cdp_cmd(
                "Network.setCookie", normalize_session_cookies([cookie], engine)[0]
            )
        if origins:
            script = _restore_script(origins)
            browser.execute_cdp_cmd(
                "Page.addScriptToEvaluateOnNewDocument", {"source": script}
            )
            browser.execute_script(script)
        return
    raise ValueError(f"Unsupported storage-state engine: {engine}")


def _current_origin(url: str) -> str | None:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


async def save_storage_state(
    engine: str,
    browser: Any,
    page: Any,
    file_path: str | Path | None = None,
) -> dict[str, Any]:
    """Export Playwright storage state, or Selenium's current origin and cookies."""

    if engine == "playwright":
        context = browser if hasattr(browser, "storage_state") else page.context
        state = await context.storage_state()
    elif engine == "selenium":
        cookies = []
        try:
            raw_cookies = browser.execute_cdp_cmd("Network.getAllCookies", {}).get(
                "cookies", []
            )
            if not isinstance(raw_cookies, list):
                raw_cookies = browser.get_cookies()
        except (AttributeError, NotImplementedError):
            raw_cookies = browser.get_cookies()
        for raw_cookie in raw_cookies:
            cookie = dict(raw_cookie)
            cookie["expires"] = cookie.pop("expiry", cookie.get("expires", -1))
            cookies.append(cookie)
        origin = _current_origin(browser.current_url)
        origins = []
        if origin is not None:
            items = browser.execute_script(
                "return Array.from({ length: localStorage.length }, (_, index) => "
                "({ name: localStorage.key(index), value: "
                "localStorage.getItem(localStorage.key(index)) }));"
            )
            origins.append({"origin": origin, "localStorage": items})
        state = {"cookies": cookies, "origins": origins}
    else:
        raise ValueError(f"Unsupported storage-state engine: {engine}")
    if file_path is not None:
        write_restricted_state(file_path, state)
    return state


def write_restricted_state(path: str | Path, state: dict) -> None:
    path = Path(path)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent, delete=False
        ) as handle:
            temporary = Path(handle.name)
            json.dump(state, handle, indent=2)
            handle.write("\n")
        temporary.replace(path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
