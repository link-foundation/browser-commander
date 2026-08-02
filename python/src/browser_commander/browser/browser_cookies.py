"""Import cookies from installed browser profiles."""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import time
from collections.abc import Mapping
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal

from browser_commander.browser.browser_cookie_cache import (
    NormalizedCookieCache,
    clear_browser_cookie_memory_cache,
    get_cached_credential,
    normalize_cookie_cache,
    read_cookie_result_cache,
    write_cookie_result_cache,
)
from browser_commander.browser.browser_cookie_credentials import (
    decrypt_windows_dpapi,
    read_safe_storage_password,
    read_windows_encryption_key,
)
from browser_commander.browser.browser_cookie_crypto import (
    chromium_same_site,
    decode_chromium_cookie_plaintext,
    decrypt_chromium_cookie,
    derive_chromium_cookie_key,
    firefox_same_site,
)
from browser_commander.browser.browser_profiles import (
    BrowserProfile,
    find_cookie_database,
    list_browser_profiles,
    normalize_cookie_browser,
    resolve_browser_profile,
)

CHROME_EPOCH_OFFSET_SECONDS = 11_644_473_600


@dataclass(frozen=True)
class BrowserCookieCacheOptions:
    """Disk cache location and TTL for imported cookies and derived keys."""

    dir: str | Path | None = None
    ttl_minutes: float = 60


@dataclass(frozen=True)
class BrowserCookieReadOptions:
    """Options for reading an installed browser's cookies."""

    browser: str
    profile: str | None = None
    domain_filter: str | None = None
    cache: BrowserCookieCacheOptions | Literal[False] | None = None
    ttl_minutes: float | None = None
    refresh: bool = False
    ignore_decryption_errors: bool = False


def _open_cookie_database(cookie_path: Path) -> sqlite3.Connection:
    try:
        connection = sqlite3.connect(
            f"{cookie_path.resolve().as_uri()}?mode=ro", uri=True
        )
    except sqlite3.Error as error:
        raise RuntimeError(
            f"Could not open browser cookie database: {error}"
        ) from error
    connection.row_factory = sqlite3.Row
    return connection


def _read_database_version(database: sqlite3.Connection) -> int:
    try:
        row = database.execute(
            "SELECT value FROM meta WHERE key = 'version'"
        ).fetchone()
        return int(row["value"]) if row else 0
    except (sqlite3.Error, TypeError, ValueError):
        return 0


def _domain_query(column: str, domain_filter: str | None) -> tuple[str, tuple]:
    return (
        (f" WHERE {column} LIKE ?", (f"%{domain_filter}%",))
        if domain_filter
        else ("", ())
    )


def _read_firefox_rows(
    database: sqlite3.Connection, domain_filter: str | None
) -> list[sqlite3.Row]:
    where, parameters = _domain_query("host", domain_filter)
    return database.execute(
        "SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite "
        f"FROM moz_cookies{where} ORDER BY host, name, path",
        parameters,
    ).fetchall()


def _read_chromium_rows(
    database: sqlite3.Connection, domain_filter: str | None
) -> list[sqlite3.Row]:
    where, parameters = _domain_query("host_key", domain_filter)
    return database.execute(
        "SELECT host_key, name, value, encrypted_value, path, expires_utc, "
        f"is_secure, is_httponly, samesite FROM cookies{where} "
        "ORDER BY host_key, name, path",
        parameters,
    ).fetchall()


def _map_firefox_rows(rows: list[sqlite3.Row]) -> list[dict]:
    return [
        {
            "name": row["name"],
            "value": row["value"],
            "domain": row["host"],
            "path": row["path"] or "/",
            "expires": int(row["expiry"]) if int(row["expiry"] or 0) > 0 else -1,
            "httpOnly": bool(row["isHttpOnly"]),
            "secure": bool(row["isSecure"]),
            "sameSite": firefox_same_site(int(row["sameSite"] or 0)),
        }
        for row in rows
    ]


def _chromium_expires(value: int | str | None) -> int:
    microseconds = int(value or 0)
    if microseconds == 0:
        return -1
    return microseconds // 1_000_000 - CHROME_EPOCH_OFFSET_SECONDS


def _chromium_key_for_prefix(prefix: bytes, context: dict) -> bytes:
    platform = context["platform"]
    if platform == "linux" and prefix == b"v10":
        return derive_chromium_cookie_key("peanuts", "linux")
    if platform in ("linux", "darwin"):

        def create_key() -> bytes:
            password = context["read_safe_storage_password"](
                browser=context["browser"],
                platform=platform,
                environment=context["environment"],
            )
            return derive_chromium_cookie_key(password, platform)

        identity = f"{context['browser']}:{platform}:safe-storage"
        return _operation_credential(
            context,
            identity,
            lambda: get_cached_credential(
                context["cache"],
                identity,
                create_key,
                refresh=context["refresh"],
                metadata={
                    "browser": context["browser"],
                    "platform": platform,
                    "source": "safe-storage",
                },
                now=context["now"],
            ),
        )
    if platform == "win32":

        def create_windows_key() -> bytes:
            return context["read_windows_encryption_key"](
                local_state_path=context["profile"].path.parent / "Local State",
                environment=context["environment"],
                decrypt_dpapi=context["decrypt_windows_dpapi"],
            )

        identity = f"{context['browser']}:win32:legacy-aes-key"
        return _operation_credential(
            context,
            identity,
            lambda: get_cached_credential(
                context["cache"],
                identity,
                create_windows_key,
                refresh=context["refresh"],
                metadata={
                    "browser": context["browser"],
                    "platform": platform,
                    "source": "dpapi",
                },
                now=context["now"],
            ),
        )
    raise RuntimeError(f"Chromium cookie decryption is unsupported on {platform}")


def _operation_credential(
    context: dict, identity: str, create: Callable[[], bytes]
) -> bytes:
    attempts = context["credential_attempts"]
    if identity not in attempts:
        try:
            attempts[identity] = bytes(create())
        except Exception as error:
            attempts[identity] = error
    result = attempts[identity]
    if isinstance(result, Exception):
        raise result
    return result


def _decrypt_chromium_row(
    row: sqlite3.Row, database_version: int, context: dict
) -> str:
    if row["value"]:
        return str(row["value"])
    encrypted_value = bytes(row["encrypted_value"] or b"")
    if not encrypted_value:
        return ""
    prefix = encrypted_value[:3]
    if context["platform"] == "win32" and prefix not in (b"v10", b"v11"):
        if prefix == b"v20":
            return decrypt_chromium_cookie(
                encrypted_value,
                host=row["host_key"],
                database_version=database_version,
                platform="win32",
                key=bytes(32),
            )
        plaintext = context["decrypt_windows_dpapi"](encrypted_value)
        return decode_chromium_cookie_plaintext(
            plaintext,
            host=row["host_key"],
            database_version=database_version,
        )
    key = _chromium_key_for_prefix(prefix, context)
    return decrypt_chromium_cookie(
        encrypted_value,
        host=row["host_key"],
        database_version=database_version,
        platform=context["platform"],
        key=key,
    )


def _map_chromium_rows(
    rows: list[sqlite3.Row], database_version: int, context: dict
) -> list[dict]:
    cookies = []
    for row in rows:
        try:
            cookies.append(
                {
                    "name": row["name"],
                    "value": _decrypt_chromium_row(row, database_version, context),
                    "domain": row["host_key"],
                    "path": row["path"] or "/",
                    "expires": _chromium_expires(row["expires_utc"]),
                    "httpOnly": bool(row["is_httponly"]),
                    "secure": bool(row["is_secure"]),
                    "sameSite": chromium_same_site(int(row["samesite"])),
                }
            )
        except Exception as error:
            if not context["ignore_decryption_errors"]:
                raise RuntimeError(
                    f"Could not decrypt cookie {row['name']} for "
                    f"{row['host_key']}: {error}"
                ) from error
    return cookies


def _read_uncached_cookies(
    browser: str,
    cookie_path: Path,
    domain_filter: str | None,
    context: dict,
) -> list[dict]:
    # closing() is required: sqlite3.Connection.__exit__ only commits or rolls
    # back the transaction, it does not close the connection. Using the bare
    # connection as a context manager leaked a handle per read and produced
    # "ResourceWarning: unclosed database" in every CI test run.
    with closing(_open_cookie_database(cookie_path)) as database:
        if browser == "firefox":
            return _map_firefox_rows(_read_firefox_rows(database, domain_filter))
        database_version = _read_database_version(database)
        return _map_chromium_rows(
            _read_chromium_rows(database, domain_filter), database_version, context
        )


def read_browser_cookies_with_dependencies(
    options: BrowserCookieReadOptions,
    *,
    platform: str = sys.platform,
    home_dir: Path | None = None,
    environment: Mapping[str, str] | None = None,
    now: Callable[[], float] = time.time,
    read_safe_storage_password=read_safe_storage_password,
    read_windows_encryption_key=read_windows_encryption_key,
    decrypt_windows_dpapi=decrypt_windows_dpapi,
) -> list[dict]:
    """Read installed-browser cookies with injectable platform dependencies."""
    if not isinstance(options, BrowserCookieReadOptions):
        raise TypeError("options must be a BrowserCookieReadOptions instance")
    browser = normalize_cookie_browser(options.browser)
    home_dir = home_dir or Path.home()
    environment = os.environ if environment is None else environment
    profile = resolve_browser_profile(
        browser,
        options.profile,
        platform=platform,
        home_dir=home_dir,
        environment=environment,
    )
    cookie_path = find_cookie_database(browser, profile.path)
    if cookie_path is None:
        raise FileNotFoundError(f"No cookie database exists in {profile.path}")
    cache: NormalizedCookieCache = normalize_cookie_cache(
        options.cache, home_dir, options.ttl_minutes
    )
    identity = json.dumps(
        {
            "browser": browser,
            "profile": str(profile.path),
            "domain_filter": options.domain_filter,
            "ignore_decryption_errors": options.ignore_decryption_errors,
        },
        sort_keys=True,
    )
    cached_cookies = read_cookie_result_cache(
        cache, identity, refresh=options.refresh, now=now
    )
    if cached_cookies is not None:
        return cached_cookies

    cookies = _read_uncached_cookies(
        browser,
        cookie_path,
        options.domain_filter,
        {
            "browser": browser,
            "cache": cache,
            "credential_attempts": {},
            "decrypt_windows_dpapi": decrypt_windows_dpapi,
            "environment": environment,
            "ignore_decryption_errors": options.ignore_decryption_errors,
            "now": now,
            "platform": platform,
            "profile": profile,
            "read_safe_storage_password": read_safe_storage_password,
            "read_windows_encryption_key": read_windows_encryption_key,
            "refresh": options.refresh,
        },
    )
    write_cookie_result_cache(cache, identity, cookies, now=now)
    return cookies


def read_browser_cookies(options: BrowserCookieReadOptions) -> list[dict]:
    """Read cookies from an installed browser profile in automation shape."""
    return read_browser_cookies_with_dependencies(options)


__all__ = [
    "BrowserCookieCacheOptions",
    "BrowserCookieReadOptions",
    "BrowserProfile",
    "clear_browser_cookie_memory_cache",
    "decrypt_chromium_cookie",
    "list_browser_profiles",
    "read_browser_cookies",
    "read_browser_cookies_with_dependencies",
]
