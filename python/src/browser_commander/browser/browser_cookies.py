"""Import cookies from installed browser profiles."""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import time
from collections.abc import Mapping, Sequence
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
from browser_commander.browser.browser_profile_files import local_state_path_for_profile
from browser_commander.browser.browser_profiles import (
    BrowserProfile,
    find_cookie_database,
    is_default_browser_keyword,
    list_browser_profiles,
    resolve_browser_profile,
    resolve_source_browser,
)
from browser_commander.browser.browser_sources import browser_family
from browser_commander.browser.default_browser import (
    RunCommand,
    resolve_default_browser,
)
from browser_commander.browser.safari_cookies import (
    count_safari_cookies,
    parse_safari_cookies,
    read_safari_cookie_file,
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
    profile_dir: str | Path | None = None
    domain_filter: str | None = None
    cache: BrowserCookieCacheOptions | Literal[False] | None = None
    ttl_minutes: float | None = None
    refresh: bool = False
    ignore_decryption_errors: bool = False
    via: Literal["browser", "database", "keychain"] | None = None
    keystore: Literal["os", "mock"] = "os"


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
    # Firefox schema 16 changed Unix expiry seconds to milliseconds. Keep the
    # public cookie shape in seconds for installed reading and migration alike.
    version = database.execute("PRAGMA user_version").fetchone()[0]
    expiry = "expiry / 1000 AS expiry" if version >= 16 else "expiry"
    where, parameters = _domain_query("host", domain_filter)
    return database.execute(
        f"SELECT name, value, host, path, {expiry}, isSecure, isHttpOnly, sameSite "
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
    if context.get("keystore") == "mock":
        if platform == "win32":
            raise RuntimeError(
                "Use read_browser_cookie_session for Windows mock-keystore profiles"
            )
        return derive_chromium_cookie_key(
            "mock_password" if platform == "darwin" else "peanuts", platform
        )
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
                local_state_path=local_state_path_for_profile(context["profile_path"]),
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
    if browser_family(browser) == "safari":
        return parse_safari_cookies(
            read_safari_cookie_file(cookie_path, environment=context["environment"]),
            domain_filter,
        )
    with closing(_open_cookie_database(cookie_path)) as database:
        if browser_family(browser) == "firefox":
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
    run_command: RunCommand | None = None,
    read_safe_storage_password=read_safe_storage_password,
    read_windows_encryption_key=read_windows_encryption_key,
    decrypt_windows_dpapi=decrypt_windows_dpapi,
) -> list[dict]:
    """Read installed-browser cookies with injectable platform dependencies."""
    if not isinstance(options, BrowserCookieReadOptions):
        raise TypeError("options must be a BrowserCookieReadOptions instance")
    home_dir = home_dir or Path.home()
    environment = os.environ if environment is None else environment
    browser = resolve_source_browser(
        options.browser,
        platform=platform,
        environment=environment,
        run_command=run_command,
    )
    # A caller that already resolved the profile directory (for example a
    # migration honouring a custom ``user_data_dir``) passes it as
    # ``profile_dir``, so the reader does not re-resolve the default profile.
    if options.profile_dir is not None:
        profile_path = Path(options.profile_dir)
    else:
        profile_path = resolve_browser_profile(
            browser,
            options.profile,
            platform=platform,
            home_dir=home_dir,
            environment=environment,
            run_command=run_command,
        ).path
    cookie_path = find_cookie_database(browser, profile_path)
    if cookie_path is None:
        raise FileNotFoundError(f"No cookie database exists in {profile_path}")
    cache: NormalizedCookieCache = normalize_cookie_cache(
        options.cache, home_dir, options.ttl_minutes
    )
    identity = json.dumps(
        {
            "browser": browser,
            "profile": str(profile_path),
            "domain_filter": options.domain_filter,
            "ignore_decryption_errors": options.ignore_decryption_errors,
            "keystore": options.keystore,
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
            "profile_path": profile_path,
            "read_safe_storage_password": read_safe_storage_password,
            "read_windows_encryption_key": read_windows_encryption_key,
            "refresh": options.refresh,
            "keystore": options.keystore,
        },
    )
    write_cookie_result_cache(cache, identity, cookies, now=now)
    return cookies


def read_browser_cookies(options: BrowserCookieReadOptions) -> list[dict]:
    """Read cookies from an installed browser profile in automation shape."""
    via = options.via or (
        "browser"
        if sys.platform == "darwin"
        and options.keystore != "mock"
        and browser_family(resolve_source_browser(options.browser)) == "chromium"
        else "database"
    )
    if via == "browser":
        import asyncio
        from concurrent.futures import ThreadPoolExecutor

        from browser_commander.browser.browser_cookie_session import (
            read_browser_cookie_session,
        )

        def run():
            return asyncio.run(read_browser_cookie_session(options))

        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return run()
        with ThreadPoolExecutor(max_workers=1) as executor:
            return executor.submit(run).result()
    return read_browser_cookies_with_dependencies(options)


@dataclass(frozen=True)
class CookieSource:
    """A profile that holds cookies, with counts only, never values.

    ``cookies`` is the total row count; ``by_domain`` maps each requested
    domain to its matching count (``None`` when no domain filter was given).
    ``error`` is set instead of counts when the database could not be opened.
    """

    browser: str
    profile: str
    path: Path
    is_default: bool
    cookies: int | None = None
    by_domain: dict[str, int] | None = None
    error: str | None = None


def _count_cookies_by_domain(
    database: sqlite3.Connection, family: str, domains: Sequence[str] | None
) -> tuple[int, dict[str, int] | None]:
    """Count cookies by domain without ever reading a cookie value.

    Only host names and row counts are touched, so this is safe to expose for
    a "which browser holds cookies for this domain" listing.
    """
    from .migration.domains import matches_domains

    column = "host" if family == "firefox" else "host_key"
    table = "moz_cookies" if family == "firefox" else "cookies"
    total = int(database.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"])
    if not domains:
        return total, None
    by_domain = dict.fromkeys(domains, 0)
    hosts = database.execute(
        f"SELECT {column} AS host, COUNT(*) AS n FROM {table} GROUP BY {column}"
    )
    for row in hosts:
        for domain in by_domain:
            if matches_domains(row["host"] or "", [domain]):
                by_domain[domain] += int(row["n"])
    return total, by_domain


def list_cookie_sources(
    *,
    domains: Sequence[str] | None = None,
    platform: str = sys.platform,
    home_dir: Path | None = None,
    environment: Mapping[str, str] | None = None,
) -> list[CookieSource]:
    """List installed browser profiles that hold cookies, with counts only.

    Per-domain counts are included when ``domains`` is given, and profiles that
    match none of them are skipped. Cookie values are never read or returned,
    this is the data behind the ``cookies sources`` command.
    """
    home_dir = home_dir or Path.home()
    environment = os.environ if environment is None else environment
    profiles = list_browser_profiles(
        platform=platform, home_dir=home_dir, environment=environment
    )
    sources: list[CookieSource] = []
    for profile in profiles:
        if profile.error:
            sources.append(
                CookieSource(
                    browser=profile.browser,
                    profile=profile.name,
                    path=profile.path,
                    is_default=profile.is_default,
                    error=profile.error,
                )
            )
            continue
        cookie_path = find_cookie_database(profile.browser, profile.path)
        if cookie_path is None:
            continue
        family = browser_family(profile.browser)
        try:
            if family == "safari":
                total, by_domain = count_safari_cookies(
                    read_safari_cookie_file(cookie_path, environment=environment),
                    domains,
                )
            else:
                with closing(_open_cookie_database(cookie_path)) as database:
                    total, by_domain = _count_cookies_by_domain(
                        database, family, domains
                    )
        except (sqlite3.Error, RuntimeError, OSError, ValueError) as error:
            sources.append(
                CookieSource(
                    browser=profile.browser,
                    profile=profile.name,
                    path=profile.path,
                    is_default=profile.is_default,
                    error=str(error),
                )
            )
            continue
        # When filtering by domain, skip profiles that hold none of them.
        matched = sum(by_domain.values()) if by_domain is not None else total
        if domains and matched == 0:
            continue
        sources.append(
            CookieSource(
                browser=profile.browser,
                profile=profile.name,
                path=profile.path,
                is_default=profile.is_default,
                cookies=total,
                by_domain=by_domain,
            )
        )
    return sources


@dataclass(frozen=True)
class ImportSource:
    """The browser an import reads from, as chosen by :func:`resolve_import_source`.

    ``profile`` is the profile holding the requested cookies (``None`` when no
    profile was chosen) and ``warning`` is a migration-report warning that
    explains a fallback away from the system default, or ``None``.
    """

    browser: str
    profile: str | None = None
    warning: dict[str, str] | None = None


def _matched_cookies(source: CookieSource) -> int:
    return sum((source.by_domain or {}).values())


def resolve_import_source(
    browser: str,
    *,
    domains: Sequence[str] | None = None,
    platform: str = sys.platform,
    home_dir: Path | None = None,
    environment: Mapping[str, str] | None = None,
    run_command: RunCommand | None = None,
) -> ImportSource:
    """Pick the source browser for an import.

    A ``default``/``auto`` request scoped to ``domains`` uses the system default
    browser when it holds cookies for them and otherwise falls back to the
    installed browser profile holding the most, so "import my github.com
    sign-in" works whichever browser has it. Only names and counts are read
    (see :func:`list_cookie_sources`), never cookie values.
    """
    if not is_default_browser_keyword(browser) or not domains:
        return ImportSource(
            browser=resolve_source_browser(
                browser,
                platform=platform,
                environment=environment,
                run_command=run_command,
            )
        )
    system_default = resolve_default_browser(
        platform=platform, environment=environment, run_command=run_command
    )
    listed_sources = list_cookie_sources(
        domains=domains, platform=platform, home_dir=home_dir, environment=environment
    )
    holders = [source for source in listed_sources if source.error is None]
    from_default = [source for source in holders if source.browser == system_default]
    unreadable_default = next(
        (
            source
            for source in listed_sources
            if source.browser == system_default and source.error
        ),
        None,
    )
    if not from_default and unreadable_default:
        raise RuntimeError(
            f"Could not inspect the default browser ({system_default}): {unreadable_default.error}"
        )
    candidates = from_default or holders
    if not candidates:
        if not system_default:
            raise ValueError(
                "Could not determine the system default browser, and no "
                f"installed browser holds cookies for {', '.join(domains)}."
            )
        return ImportSource(browser=system_default)
    # The first profile with the most matching cookies; listing order breaks
    # ties, so a browser's default profile wins over its others.
    best = candidates[0]
    for source in candidates[1:]:
        if _matched_cookies(source) > _matched_cookies(best):
            best = source
    warning = None
    if best.browser != system_default:
        reason = (
            f"The default browser ({system_default}) holds no cookies for"
            if system_default
            else "Could not determine the default browser to read cookies for"
        )
        warning = {
            "type": "source",
            "item": best.browser,
            "reason": "default-browser-fallback"
            if system_default
            else "default-browser-unknown",
            "detail": f"{reason} {', '.join(domains)}; "
            f"imported from {best.browser} instead.",
        }
    return ImportSource(browser=best.browser, profile=best.profile, warning=warning)


__all__ = [
    "BrowserCookieCacheOptions",
    "BrowserCookieReadOptions",
    "BrowserProfile",
    "CookieSource",
    "ImportSource",
    "clear_browser_cookie_memory_cache",
    "decrypt_chromium_cookie",
    "list_browser_profiles",
    "list_cookie_sources",
    "read_browser_cookies",
    "read_browser_cookies_with_dependencies",
    "resolve_import_source",
]
