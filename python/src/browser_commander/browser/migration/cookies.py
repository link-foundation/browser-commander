"""Read a source profile's cookies for seeding over CDP after launch.

Cookies are not written into the target ``Cookies`` database: a running
Chromium re-derives its own encryption, so the launcher seeds them with
``Network.setCookies`` once connected. Google's Device Bound Session
Credentials (DBSC) bind a few rotating session cookies to a key held by the
source device; those are migrated but reported, because they will expire in
the new profile.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

from browser_commander.browser.browser_cookies import (
    BrowserCookieReadOptions,
    read_browser_cookies_with_dependencies,
)
from browser_commander.browser.migration.fs_utils import PathLike

__all__ = [
    "DBSC_BOUND_COOKIE_NAMES",
    "is_dbsc_bound_cookie",
    "migrate_cookies",
    "read_source_cookies",
]

#: Google session-token cookies bound to the source device by DBSC.
DBSC_BOUND_COOKIE_NAMES = ("__Secure-1PSIDTS", "__Secure-3PSIDTS", "SIDTS")

_DBSC_REGISTRATION_FILES = (
    Path("Network") / "DeviceBoundSessions",
    Path("DeviceBoundSessions"),
)

_GOOGLE_HOST = re.compile(r"(?:^|\.)google\.[a-z.]+\Z")

_DBSC_WARNING_DETAIL = (
    "The source profile has a Device Bound Session registration; cookies "
    "covered by it are bound to the source device key and will expire in the "
    "migrated profile."
)


def _is_google_host(domain: Any) -> bool:
    host = str(domain or "")
    host = (host[1:] if host.startswith(".") else host).lower()
    return (
        host == "google.com"
        or host.endswith(".google.com")
        or _GOOGLE_HOST.search(host) is not None
    )


def is_dbsc_bound_cookie(cookie: Mapping[str, Any]) -> bool:
    """Return whether a cookie is one of Google's DBSC-bound session tokens."""

    return _is_google_host(cookie.get("domain")) and (
        cookie.get("name") in DBSC_BOUND_COOKIE_NAMES
    )


def _find_dbsc_registration(profile_dir: PathLike) -> Path | None:
    for relative in _DBSC_REGISTRATION_FILES:
        candidate = Path(profile_dir) / relative
        if candidate.exists():
            return candidate
    return None


def read_source_cookies(
    *,
    browser: str,
    profile: str | None = None,
    profile_dir: PathLike | None = None,
    domain_filter: str | None = None,
    ignore_decryption_errors: bool = True,
    platform: str | None = None,
    home_dir: PathLike | None = None,
    environment: Mapping[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Default cookie reader: the installed-browser cookie importer."""

    extra: dict[str, Any] = {}
    if platform is not None:
        extra["platform"] = platform
    return read_browser_cookies_with_dependencies(
        BrowserCookieReadOptions(
            browser=browser,
            profile=profile,
            profile_dir=None if profile_dir is None else Path(profile_dir),
            domain_filter=domain_filter,
            ignore_decryption_errors=ignore_decryption_errors,
        ),
        home_dir=None if home_dir is None else Path(home_dir),
        environment=environment,
        **extra,
    )


def migrate_cookies(
    *,
    browser: str,
    profile: str | None = None,
    source_profile_dir: PathLike | None = None,
    domains: Sequence[str] | None = None,
    read_cookies: Callable[..., list[dict[str, Any]]] = read_source_cookies,
    reader_options: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Read the source cookies, deduplicated across domain filters.

    Args:
        browser: Source browser (``chrome``, ``edge``, ``brave``, ...).
        profile: Source profile name.
        source_profile_dir: Checked for a DBSC registration.
        domains: Host substrings to read; all cookies when empty.
        read_cookies: ``read_cookies(browser=, profile=, domain_filter=,
            ignore_decryption_errors=True, **reader_options)``.
        reader_options: Extra keywords for the reader (``platform``,
            ``home_dir``, ``environment``).

    Returns:
        ``{"cookies": [...], "migrated": n, "skipped": [...], "warnings": [...]}``.
    """

    domain_filters: list[str | None] = list(domains) if domains else [None]
    seen: dict[str, dict[str, Any]] = {}
    for domain_filter in domain_filters:
        batch = read_cookies(
            browser=browser,
            profile=profile,
            # Read from the exact directory the migration resolved (which
            # honours a custom ``user_data_dir``) instead of re-resolving the
            # default profile.
            profile_dir=source_profile_dir,
            domain_filter=domain_filter,
            ignore_decryption_errors=True,
            **dict(reader_options or {}),
        )
        for cookie in batch:
            key = f"{cookie.get('domain')}\0{cookie.get('name')}\0{cookie.get('path')}"
            # Later batches win, but the first position is kept, as with a
            # JavaScript Map.
            seen[key] = cookie
    from .domains import matches_domains

    cookies = [
        cookie
        for cookie in seen.values()
        if matches_domains(cookie.get("domain", ""), domains)
    ]

    skipped = [
        {
            "type": "cookies",
            "item": f"{cookie.get('domain')} {cookie.get('name')}",
            "reason": "dbsc-bound",
        }
        for cookie in cookies
        if is_dbsc_bound_cookie(cookie)
    ]
    warnings: list[dict[str, Any]] = []
    if source_profile_dir and _find_dbsc_registration(source_profile_dir):
        warnings.append(
            {
                "type": "cookies",
                "item": "DeviceBoundSessions",
                "reason": "dbsc-registration-present",
                "detail": _DBSC_WARNING_DETAIL,
            }
        )
    return {
        "cookies": cookies,
        "migrated": len(cookies),
        "skipped": skipped,
        "warnings": warnings,
    }
