"""Profile migration orchestrator.

Copies a person's data from a real browser profile into a dedicated target
profile, one data class at a time, and returns the report shape documented in
``docs/cli-and-bridge.md``. Nothing is written to the source profile, and every
database read goes through a consistent read-only snapshot, so migration is
safe while the source browser is open.

Cookies are returned rather than written: a running Chromium re-derives its
own cookie encryption, so the launcher seeds them over CDP with the existing
``seed_cookies`` path. Every other data class is written into the target
profile directory.
"""

from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

from browser_commander.browser.browser_cookies import resolve_import_source
from browser_commander.browser.browser_profiles import (
    browser_profile_root,
    resolve_browser_profile,
)
from browser_commander.browser.browser_sources import (
    browser_family,
    is_single_profile_browser,
)
from browser_commander.browser.default_browser import RunCommand
from browser_commander.browser.migration.bookmarks import migrate_bookmarks
from browser_commander.browser.migration.cookies import migrate_cookies
from browser_commander.browser.migration.extensions import migrate_extensions
from browser_commander.browser.migration.firefox import (
    migrate_firefox_bookmarks,
    migrate_firefox_passwords,
    read_firefox_cookies,
    report_firefox_history,
)
from browser_commander.browser.migration.fs_utils import PathLike
from browser_commander.browser.migration.history import migrate_history
from browser_commander.browser.migration.os_crypt_keys import (
    create_source_key_resolver,
    local_state_path_for_profile,
    resolve_target_key,
)
from browser_commander.browser.migration.passwords import migrate_passwords
from browser_commander.browser.migration.preferences import migrate_preferences

__all__ = ["ALL_DATA_CLASSES", "migrate_profile", "migrate_profile_sync"]

#: Every data class a migration can move, in report order.
ALL_DATA_CLASSES = (
    "cookies",
    "bookmarks",
    "history",
    "passwords",
    "preferences",
    "extensions",
)

_TARGET_KEY_UNAVAILABLE_DETAIL = (
    "A target encryption key was not available (on Windows the launcher must "
    "generate one and write it into the target Local State); passwords were "
    "not migrated."
)


def _empty_migrated() -> dict[str, int]:
    return dict.fromkeys(ALL_DATA_CLASSES, 0)


def _resolve_source_profile_dir(
    *,
    browser: str,
    profile: str,
    user_data_dir: PathLike | None,
    platform: str,
    home_dir: Path,
    environment: Mapping[str, str],
) -> Path:
    # A Chromium profile lives in a named subdirectory of the user data dir,
    # except in single-profile browsers (Opera) that keep it in the root; for
    # Firefox the user data dir already is the profile.
    is_chromium = browser_family(browser) == "chromium"
    nests_profiles = is_chromium and not is_single_profile_browser(browser)
    if user_data_dir:
        return Path(user_data_dir) / profile if nests_profiles else Path(user_data_dir)
    if is_chromium:
        root = browser_profile_root(
            browser, platform=platform, home_dir=home_dir, environment=environment
        )
        if root is None:
            raise FileNotFoundError(f"{browser} has no profile directory on {platform}")
        return root / profile if nests_profiles else root
    return resolve_browser_profile(
        browser,
        profile,
        platform=platform,
        home_dir=home_dir,
        environment=environment,
    ).path


def _merge_report(
    report: dict[str, Any], class_name: str, fragment: Mapping[str, Any]
) -> None:
    report["migrated"][class_name] += fragment.get("migrated") or 0
    report["skipped"].extend(fragment.get("skipped") or [])
    report["warnings"].extend(fragment.get("warnings") or [])


def _resolve_password_keys(
    *,
    keys: Mapping[str, Any] | None,
    browser: str,
    target_browser: str,
    platform: str,
    source_profile_dir: Path,
    environment: Mapping[str, str],
) -> Mapping[str, Any] | None:
    if keys and keys.get("target_key"):
        return keys
    if platform not in ("darwin", "linux"):
        return None
    target = resolve_target_key(
        browser=target_browser, platform=platform, environment=environment
    )
    resolve_source_key = (
        create_source_key_resolver(
            browser=browser,
            platform=platform,
            local_state_path=local_state_path_for_profile(source_profile_dir),
            environment=environment,
        )
        if browser_family(browser) == "chromium"
        else None
    )
    return {
        "target_key": target["key"],
        "target_prefix": target["prefix"],
        "resolve_source_key": resolve_source_key,
    }


def migrate_profile_sync(
    *,
    from_: Mapping[str, Any],
    to: PathLike,
    include: Iterable[str] = ALL_DATA_CLASSES,
    domains: Sequence[str] | None = None,
    platform: str | None = None,
    target_browser: str | None = None,
    keys: Mapping[str, Any] | None = None,
    home_dir: PathLike | None = None,
    environment: Mapping[str, str] | None = None,
    run_command: RunCommand | None = None,
) -> dict[str, Any]:
    """Synchronous :func:`migrate_profile`; see it for the arguments."""

    if not isinstance(from_, Mapping) or not from_.get("browser"):
        msg = "migrate_profile requires from_['browser']"
        raise TypeError(msg)
    if not to:
        msg = "migrate_profile requires a target directory (to)"
        raise TypeError(msg)
    platform = sys.platform if platform is None else platform
    home = Path.home() if home_dir is None else Path(home_dir)
    env: Mapping[str, str] = os.environ if environment is None else environment
    target_dir = Path(to)

    user_data_dir = from_.get("user_data_dir", from_.get("userDataDir"))
    # An explicit user data dir names the source, so only an installed-browser
    # import is steered towards the profile holding the requested domains.
    source = resolve_import_source(
        str(from_["browser"]),
        domains=None if user_data_dir else domains,
        platform=platform,
        home_dir=home,
        environment=env,
        run_command=run_command,
    )
    browser = source.browser
    profile_value = from_.get("profile")
    if profile_value is None:
        profile_value = source.profile
    profile = "Default" if profile_value is None else str(profile_value)
    is_firefox = browser_family(browser) == "firefox"
    source_profile_dir = _resolve_source_profile_dir(
        browser=browser,
        profile=profile,
        user_data_dir=user_data_dir,
        platform=platform,
        home_dir=home,
        environment=env,
    )
    selected = set(include)
    report: dict[str, Any] = {
        "source": {
            "browser": browser,
            "profile": profile,
            "userDataDir": None if user_data_dir is None else os.fspath(user_data_dir),
        },
        "target": os.fspath(to),
        "migrated": _empty_migrated(),
        "skipped": [],
        "warnings": [],
        "cookies": [],
    }
    if source.warning is not None:
        report["warnings"].append(source.warning)

    if "cookies" in selected:
        if is_firefox:
            cookies = read_firefox_cookies(
                profile_dir=source_profile_dir, domains=domains
            )
            report["cookies"] = cookies
            report["migrated"]["cookies"] = len(cookies)
        else:
            fragment = migrate_cookies(
                browser=browser,
                profile=profile,
                source_profile_dir=source_profile_dir,
                domains=domains,
                reader_options={
                    "platform": platform,
                    "home_dir": home,
                    "environment": env,
                },
            )
            report["cookies"] = fragment["cookies"]
            report["migrated"]["cookies"] = fragment["migrated"]
            report["skipped"].extend(fragment["skipped"])
            report["warnings"].extend(fragment["warnings"])

    if browser_family(browser) == "safari":
        for type_ in ALL_DATA_CLASSES:
            if type_ == "cookies" or type_ not in selected:
                continue
            report["skipped"].append(
                {
                    "type": type_,
                    "item": browser,
                    "reason": "safari-password-export-required"
                    if type_ == "passwords"
                    else "safari-class-not-supported",
                    "detail": (
                        "Safari passwords live in the Keychain. Export Passwords from Safari or the Passwords app to CSV; CSV import is tracked separately and is not supported yet."
                        if type_ == "passwords"
                        else "Safari currently supports cookie import only; this data class has not been translated."
                    ),
                }
            )
        if report["cookies"]:
            report["warnings"].append(
                {
                    "type": "cookies",
                    "item": browser,
                    "reason": "safari-samesite-unavailable",
                    "detail": "Cookies.binarycookies does not store SameSite; imported cookies use Lax.",
                }
            )
        return report

    if "bookmarks" in selected:
        _merge_report(
            report,
            "bookmarks",
            migrate_firefox_bookmarks(
                profile_dir=source_profile_dir, target_profile_dir=target_dir
            )
            if is_firefox
            else migrate_bookmarks(
                source_profile_dir=source_profile_dir, target_profile_dir=target_dir
            ),
        )

    if "history" in selected:
        _merge_report(
            report,
            "history",
            report_firefox_history(profile_dir=source_profile_dir)
            if is_firefox
            else migrate_history(
                source_profile_dir=source_profile_dir, target_profile_dir=target_dir
            ),
        )

    if "preferences" in selected and not is_firefox:
        _merge_report(
            report,
            "preferences",
            migrate_preferences(
                source_profile_dir=source_profile_dir, target_profile_dir=target_dir
            ),
        )

    if "extensions" in selected and not is_firefox:
        _merge_report(
            report,
            "extensions",
            migrate_extensions(
                source_profile_dir=source_profile_dir, target_profile_dir=target_dir
            ),
        )

    if "passwords" in selected:
        password_keys = _resolve_password_keys(
            keys=keys,
            browser=browser,
            target_browser=target_browser or ("chrome" if is_firefox else browser),
            platform=platform,
            source_profile_dir=source_profile_dir,
            environment=env,
        )
        if not password_keys or not password_keys.get("target_key"):
            report["skipped"].append(
                {
                    "type": "passwords",
                    "item": "Login Data",
                    "reason": "target-key-unavailable",
                }
            )
            report["warnings"].append(
                {
                    "type": "passwords",
                    "item": "Login Data",
                    "reason": "target-key-unavailable",
                    "detail": _TARGET_KEY_UNAVAILABLE_DETAIL,
                }
            )
        elif is_firefox:
            primary_password = password_keys.get("primary_password")
            _merge_report(
                report,
                "passwords",
                migrate_firefox_passwords(
                    profile_dir=source_profile_dir,
                    target_profile_dir=target_dir,
                    platform=platform,
                    target_key=password_keys["target_key"],
                    target_prefix=password_keys.get("target_prefix"),
                    primary_password=(
                        b"" if primary_password is None else primary_password
                    ),
                ),
            )
        else:
            _merge_report(
                report,
                "passwords",
                migrate_passwords(
                    source_profile_dir=source_profile_dir,
                    target_profile_dir=target_dir,
                    platform=platform,
                    resolve_source_key=password_keys.get("resolve_source_key"),
                    target_key=password_keys["target_key"],
                    target_prefix=password_keys.get("target_prefix"),
                ),
            )

    return report


async def migrate_profile(
    *,
    from_: Mapping[str, Any],
    to: PathLike,
    include: Iterable[str] = ALL_DATA_CLASSES,
    domains: Sequence[str] | None = None,
    platform: str | None = None,
    target_browser: str | None = None,
    keys: Mapping[str, Any] | None = None,
    home_dir: PathLike | None = None,
    environment: Mapping[str, str] | None = None,
    run_command: RunCommand | None = None,
) -> dict[str, Any]:
    """Migrate a browser profile into a dedicated target profile directory.

    The filesystem and SQLite work runs in a worker thread.

    Args:
        from_: ``{"browser": ..., "profile": ..., "user_data_dir": ...}``;
            ``profile`` defaults to ``"Default"``.
        to: Target profile directory (for Chromium, ``<user-data-dir>/Default``).
        include: Data classes to migrate (default :data:`ALL_DATA_CLASSES`).
        domains: Cookie host filters; all cookies when empty.
        platform: ``darwin``/``linux``/``win32``; defaults to ``sys.platform``.
        target_browser: The launching channel, for the target key derivation.
        keys: Injected password keys ``{"target_key", "target_prefix",
            "resolve_source_key", "primary_password"}``.
        home_dir: Home directory for profile discovery.
        environment: Environment for profile discovery and keyring lookups.
        run_command: Injected command runner for the default-browser lookup.
            With ``from_["browser"]`` ``default``/``auto`` and ``domains``, an
            import falls back from a default browser holding none of them to
            the installed profile holding the most, adding a
            ``default-browser-fallback`` warning.

    Returns:
        ``{"source": {"browser", "profile", "userDataDir"}, "target": str,
        "migrated": {class: n}, "skipped": [...], "warnings": [...],
        "cookies": [...]}``, byte-compatible with the JavaScript report.

    Raises:
        TypeError: When ``from_["browser"]`` or ``to`` is missing.
    """

    return await asyncio.to_thread(
        migrate_profile_sync,
        from_=from_,
        to=to,
        include=tuple(include),
        domains=domains,
        platform=platform,
        target_browser=target_browser,
        keys=keys,
        home_dir=home_dir,
        environment=environment,
        run_command=run_command,
    )
