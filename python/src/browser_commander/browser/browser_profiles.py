"""Discovery of installed browser profiles with cookie databases.

Driven by the shared ``browser-sources.json`` catalogue (via
:mod:`browser_commander.browser.browser_sources`), so adding a browser there,
an Opera, a Vivaldi, a Firefox fork or a Chrome channel, adds it here without
touching this module. The ``default``/``auto`` keywords resolve to the system
default browser through :mod:`browser_commander.browser.default_browser`.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping
from configparser import ConfigParser
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

from browser_commander.browser.browser_sources import (
    BROWSER_IDS,
    browser_family,
    is_single_profile_browser,
    normalize_browser_id,
    resolve_browser_roots,
)
from browser_commander.browser.default_browser import (
    RunCommand,
    resolve_default_browser,
)

#: Every browser profile discovery can read from, from the shared catalogue.
SUPPORTED_COOKIE_BROWSERS = BROWSER_IDS

#: Keywords that select the operating-system default browser rather than a
#: named one, so ``browser='default'`` (or ``'auto'``) imports from whatever a
#: person actually uses. Importing stays opt-in: callers pass this explicitly.
_DEFAULT_BROWSER_KEYWORDS = frozenset({"default", "auto"})


@dataclass(frozen=True)
class BrowserProfile:
    """An installed browser profile containing a cookie database."""

    browser: str
    name: str
    display_name: str
    path: Path
    is_default: bool


def normalize_cookie_browser(browser: str) -> str:
    """Resolve a browser name (id or alias) to its canonical catalogue id."""
    return normalize_browser_id(browser)


def is_default_browser_keyword(browser: object) -> bool:
    """Whether ``browser`` asks for the system default rather than a named one."""
    return (
        isinstance(browser, str)
        and browser.strip().lower() in _DEFAULT_BROWSER_KEYWORDS
    )


def resolve_source_browser(
    browser: str,
    *,
    platform: str = sys.platform,
    environment: Mapping[str, str] | None = None,
    run_command: RunCommand | None = None,
) -> str:
    """Resolve a requested browser to a canonical id.

    Expands the ``default``/``auto`` keywords to the system default browser;
    named browsers are normalized through the catalogue as before.
    """
    if not is_default_browser_keyword(browser):
        return normalize_cookie_browser(browser)
    resolved = resolve_default_browser(
        platform=platform, environment=environment, run_command=run_command
    )
    if not resolved:
        raise ValueError(
            "Could not determine the system default browser; pass an explicit "
            'browser instead of "default".'
        )
    return resolved


def _resolve_roots(
    browser: str,
    *,
    platform: str,
    home_dir: Path | None,
    environment: Mapping[str, str] | None,
) -> list[Path]:
    return [
        Path(root)
        for root in resolve_browser_roots(
            browser,
            platform=platform,
            home_dir=None if home_dir is None else str(home_dir),
            environment=environment,
        )
    ]


def browser_profile_root(
    browser: str,
    *,
    platform: str = sys.platform,
    home_dir: Path | None = None,
    environment: Mapping[str, str] | None = None,
) -> Path | None:
    """The primary profile root a browser uses, or ``None`` when it does not
    run on this platform."""
    roots = _resolve_roots(
        browser, platform=platform, home_dir=home_dir, environment=environment
    )
    return roots[0] if roots else None


def find_cookie_database(browser: str, profile_path: Path) -> Path | None:
    """Find the cookie database inside a specific browser profile."""
    if browser_family(browser) == "firefox":
        candidate = profile_path / "cookies.sqlite"
        return candidate if candidate.is_file() else None
    for candidate in (
        profile_path / "Network" / "Cookies",
        profile_path / "Cookies",
    ):
        if candidate.is_file():
            return candidate
    return None


def _read_local_state(root: Path) -> dict:
    try:
        value = json.loads((root / "Local State").read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _list_chromium_profiles(browser: str, root: Path) -> list[BrowserProfile]:
    if not root.is_dir():
        return []

    # Opera-style browsers keep one profile in the root itself rather than in
    # Default/Profile N subdirectories.
    if is_single_profile_browser(browser):
        if find_cookie_database(browser, root) is None:
            return []
        return [
            BrowserProfile(
                browser=browser,
                name="Default",
                display_name="Default",
                path=root,
                is_default=True,
            )
        ]

    local_state = _read_local_state(root)
    profile_state = local_state.get("profile", {})
    info_cache = profile_state.get("info_cache", {})
    names = set(info_cache)
    try:
        names.update(
            candidate.name
            for candidate in root.iterdir()
            if candidate.is_dir()
            and (candidate.name == "Default" or candidate.name.startswith("Profile "))
        )
    except OSError:
        return []

    default_name = profile_state.get("last_used", "Default")
    profiles = []
    for name in names:
        profile_path = root / name
        if find_cookie_database(browser, profile_path) is None:
            continue
        details = info_cache.get(name, {})
        profiles.append(
            BrowserProfile(
                browser=browser,
                name=name,
                display_name=details.get("name", name),
                path=profile_path,
                is_default=name == default_name
                or (len(names) == 1 and name == "Default"),
            )
        )
    return sorted(profiles, key=lambda item: (not item.is_default, item.name))


def _read_firefox_ini(root: Path) -> ConfigParser:
    parser = ConfigParser(interpolation=None)
    with suppress(OSError):
        parser.read(root / "profiles.ini", encoding="utf-8")
    return parser


def _list_firefox_profiles(browser: str, root: Path) -> list[BrowserProfile]:
    if not root.is_dir():
        return []
    parser = _read_firefox_ini(root)
    profiles = []
    for section_name in parser.sections():
        if not section_name.startswith("Profile"):
            continue
        section = parser[section_name]
        configured_path = section.get("Path")
        if not configured_path:
            continue
        profile_path = Path(configured_path)
        if section.get("IsRelative", "1") != "0":
            profile_path = (root / profile_path).resolve()
        if find_cookie_database(browser, profile_path) is None:
            continue
        display_name = section.get("Name", profile_path.name)
        profiles.append(
            BrowserProfile(
                browser=browser,
                name=display_name,
                display_name=display_name,
                path=profile_path,
                is_default=section.get("Default") == "1",
            )
        )
    if profiles:
        return sorted(profiles, key=lambda item: (not item.is_default, item.name))

    profiles_root = root / "Profiles"
    try:
        candidates = list(profiles_root.iterdir())
    except OSError:
        return []
    return [
        BrowserProfile(
            browser=browser,
            name=candidate.name,
            display_name=candidate.name,
            path=candidate,
            is_default=False,
        )
        for candidate in sorted(candidates)
        if candidate.is_dir() and find_cookie_database(browser, candidate)
    ]


def _list_profiles_for_browser(
    browser: str,
    *,
    platform: str,
    home_dir: Path | None,
    environment: Mapping[str, str] | None,
) -> list[BrowserProfile]:
    family = browser_family(browser)
    profiles: list[BrowserProfile] = []
    for root in _resolve_roots(
        browser, platform=platform, home_dir=home_dir, environment=environment
    ):
        if family == "firefox":
            profiles.extend(_list_firefox_profiles(browser, root))
        else:
            profiles.extend(_list_chromium_profiles(browser, root))
    return profiles


def list_browser_profiles(
    browser: str | None = None,
    *,
    platform: str = sys.platform,
    home_dir: Path | None = None,
    environment: Mapping[str, str] | None = None,
    run_command: RunCommand | None = None,
) -> list[BrowserProfile]:
    """Discover cookie-bearing profiles from installed browsers."""
    browsers = (
        (
            resolve_source_browser(
                browser,
                platform=platform,
                environment=environment,
                run_command=run_command,
            ),
        )
        if browser is not None
        else BROWSER_IDS
    )
    profiles: list[BrowserProfile] = []
    # Several Firefox channels (firefox, firefox-developer, firefox-nightly)
    # share one profile root, so a catalogue-wide scan would otherwise report
    # the same profile under each id. Keep the first (canonical) browser.
    seen: set[Path] = set()
    for candidate in browsers:
        for profile in _list_profiles_for_browser(
            candidate,
            platform=platform,
            home_dir=home_dir,
            environment=environment,
        ):
            if profile.path in seen:
                continue
            seen.add(profile.path)
            profiles.append(profile)
    return profiles


def resolve_browser_profile(
    browser: str,
    profile: str | None,
    *,
    platform: str,
    home_dir: Path,
    environment: Mapping[str, str],
    run_command: RunCommand | None = None,
) -> BrowserProfile:
    """Resolve a requested profile name or select the browser default."""
    browser = resolve_source_browser(
        browser, platform=platform, environment=environment, run_command=run_command
    )
    profiles = list_browser_profiles(
        browser,
        platform=platform,
        home_dir=home_dir,
        environment=environment,
        run_command=run_command,
    )
    if profile:
        selected = next(
            (
                candidate
                for candidate in profiles
                if profile
                in (candidate.name, candidate.display_name, candidate.path.name)
            ),
            None,
        )
    else:
        selected = next(
            (candidate for candidate in profiles if candidate.is_default),
            profiles[0] if profiles else None,
        )
    if selected is None:
        detail = f' profile "{profile}"' if profile else " profile"
        raise FileNotFoundError(
            f"Could not find a cookie database for {browser}{detail}"
        )
    return selected
