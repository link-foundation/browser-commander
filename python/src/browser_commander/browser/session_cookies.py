"""Runtime cookies with consistent session expiry and domain boundaries."""

from typing import Any

from browser_commander.browser.migration.domains import matches_domains


def normalize_session_cookies(cookies: list[dict], engine: str) -> list[dict]:
    result = []
    for value in cookies:
        cookie = dict(value)
        expires = cookie.pop("expires", None)
        if isinstance(expires, (int, float)) and expires > 0:
            cookie["expires"] = expires
        elif engine == "playwright" and expires is not None:
            cookie["expires"] = -1
        if "sameSite" in cookie:
            cookie["sameSite"] = str(cookie["sameSite"]).capitalize()
        result.append(cookie)
    return result


async def set_cookies(page: Any, engine: str, cookies: list[dict]) -> None:
    normalized = normalize_session_cookies(cookies, engine)
    if engine == "playwright":
        await page.context.add_cookies(normalized)
    else:
        try:
            for cookie in normalized:
                page.execute_cdp_cmd("Network.setCookie", cookie)
        except (AttributeError, NotImplementedError):
            from browser_commander.browser.safari_webdriver import seed_safari_state

            await seed_safari_state(page, {"cookies": normalized, "origins": []})


async def clear_cookies(page: Any, engine: str, domain: str | None = None) -> int:
    if engine == "playwright":
        cookies = await page.context.cookies()
    else:
        try:
            cookies = page.execute_cdp_cmd("Network.getAllCookies", {})["cookies"]
        except (AttributeError, NotImplementedError):
            cookies = page.get_cookies()
    selected = [
        cookie
        for cookie in cookies
        if not domain or matches_domains(cookie["domain"], [domain])
    ]
    for cookie in selected:
        identity = {key: cookie[key] for key in ("name", "domain", "path")}
        if engine == "playwright":
            await page.context.clear_cookies(**identity)
        else:
            try:
                page.execute_cdp_cmd("Network.deleteCookies", identity)
            except (AttributeError, NotImplementedError):
                page.delete_cookie(cookie["name"])
    return len(selected)
