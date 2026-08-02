"""Discovery of installed browser profiles with cookie databases."""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Mapping
from configparser import ConfigParser
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

SUPPORTED_COOKIE_BROWSERS = ("chrome", "edge", "brave", "chromium", "firefox")


@dataclass(frozen=True)
class BrowserProfile:
    """An installed browser profile containing a cookie database."""

    browser: str
    name: str
    display_name: str
    path: Path
    is_default: bool


def normalize_cookie_browser(browser: str) -> str:
    """Normalize a supported browser name or raise an actionable error."""
    normalized = "edge" if browser == "msedge" else browser
    if normalized not in SUPPORTED_COOKIE_BROWSERS:
        expected = ", ".join(SUPPORTED_COOKIE_BROWSERS)
        raise ValueError(f"Unsupported browser: {browser}. Expected one of {expected}")
    return normalized


def browser_profile_root(
    browser: str,
    *,
    platform: str = sys.platform,
    home_dir: Path | None = None,
    environment: Mapping[str, str] | None = None,
) -> Path:
    """Return the conventional user-data root for an installed browser."""
    browser = normalize_cookie_browser(browser)
    home_dir = home_dir or Path.home()
    environment = os.environ if environment is None else environment
    if platform == "darwin":
        support = home_dir / "Library" / "Application Support"
        roots = {
            "brave": support / "BraveSoftware" / "Brave-Browser",
            "chrome": support / "Google" / "Chrome",
            "chromium": support / "Chromium",
            "edge": support / "Microsoft Edge",
            "firefox": support / "Firefox",
        }
        return roots[browser]
    if platform == "win32":
        local = Path(
            environment.get("LOCALAPPDATA", str(home_dir / "AppData" / "Local"))
        )
        roaming = Path(
            environment.get("APPDATA", str(home_dir / "AppData" / "Roaming"))
        )
        roots = {
            "brave": local / "BraveSoftware" / "Brave-Browser" / "User Data",
            "chrome": local / "Google" / "Chrome" / "User Data",
            "chromium": local / "Chromium" / "User Data",
            "edge": local / "Microsoft" / "Edge" / "User Data",
            "firefox": roaming / "Mozilla" / "Firefox",
        }
        return roots[browser]
    roots = {
        "brave": home_dir / ".config" / "BraveSoftware" / "Brave-Browser",
        "chrome": home_dir / ".config" / "google-chrome",
        "chromium": home_dir / ".config" / "chromium",
        "edge": home_dir / ".config" / "microsoft-edge",
        "firefox": home_dir / ".mozilla" / "firefox",
    }
    return roots[browser]


def find_cookie_database(browser: str, profile_path: Path) -> Path | None:
    """Find the cookie database inside a specific browser profile."""
    if normalize_cookie_browser(browser) == "firefox":
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


def _list_firefox_profiles(root: Path) -> list[BrowserProfile]:
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
        if find_cookie_database("firefox", profile_path) is None:
            continue
        display_name = section.get("Name", profile_path.name)
        profiles.append(
            BrowserProfile(
                browser="firefox",
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
            browser="firefox",
            name=candidate.name,
            display_name=candidate.name,
            path=candidate,
            is_default=False,
        )
        for candidate in sorted(candidates)
        if candidate.is_dir() and find_cookie_database("firefox", candidate)
    ]


def list_browser_profiles(
    browser: str | None = None,
    *,
    platform: str = sys.platform,
    home_dir: Path | None = None,
    environment: Mapping[str, str] | None = None,
) -> list[BrowserProfile]:
    """Discover cookie-bearing profiles from installed browsers."""
    browsers = (
        (normalize_cookie_browser(browser),)
        if browser is not None
        else SUPPORTED_COOKIE_BROWSERS
    )
    profiles = []
    for candidate in browsers:
        root = browser_profile_root(
            candidate,
            platform=platform,
            home_dir=home_dir,
            environment=environment,
        )
        if candidate == "firefox":
            profiles.extend(_list_firefox_profiles(root))
        else:
            profiles.extend(_list_chromium_profiles(candidate, root))
    return profiles


def resolve_browser_profile(
    browser: str,
    profile: str | None,
    *,
    platform: str,
    home_dir: Path,
    environment: Mapping[str, str],
) -> BrowserProfile:
    """Resolve a requested profile name or select the browser default."""
    browser = normalize_cookie_browser(browser)
    profiles = list_browser_profiles(
        browser,
        platform=platform,
        home_dir=home_dir,
        environment=environment,
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
