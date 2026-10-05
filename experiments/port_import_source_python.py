"""One-off edit script: port resolveImportSource to the Python package (#114)."""

import pathlib

BASE = pathlib.Path(__file__).resolve().parent.parent / "python/src/browser_commander/browser"


def sub(text, old, new):
    assert old in text, old
    return text.replace(old, new, 1)


path = BASE / "browser_cookies.py"
s = path.read_text()
s = sub(
    s,
    '''    find_cookie_database,
    list_browser_profiles,
    resolve_browser_profile,
    resolve_source_browser,
)
from browser_commander.browser.browser_sources import browser_family
from browser_commander.browser.default_browser import RunCommand''',
    '''    find_cookie_database,
    is_default_browser_keyword,
    list_browser_profiles,
    resolve_browser_profile,
    resolve_source_browser,
)
from browser_commander.browser.browser_sources import browser_family
from browser_commander.browser.default_browser import (
    RunCommand,
    resolve_default_browser,
)''',
)
s = sub(
    s,
    '''    return sources


__all__ = [''',
    '''    return sources


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
    holders = [
        source
        for source in list_cookie_sources(
            domains=domains,
            platform=platform,
            home_dir=home_dir,
            environment=environment,
        )
        if source.error is None
    ]
    from_default = [source for source in holders if source.browser == system_default]
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


__all__ = [''',
)
s = sub(
    s,
    '''    "CookieSource",
    "clear_browser_cookie_memory_cache",''',
    '''    "CookieSource",
    "ImportSource",
    "clear_browser_cookie_memory_cache",''',
)
s = sub(
    s,
    '''    "read_browser_cookies_with_dependencies",
]''',
    '''    "read_browser_cookies_with_dependencies",
    "resolve_import_source",
]''',
)
path.write_text(s)

path = BASE / "migration/profile.py"
s = path.read_text()
s = sub(
    s,
    '''from browser_commander.browser.browser_profiles import (
    browser_profile_root,
    resolve_browser_profile,
    resolve_source_browser,
)
from browser_commander.browser.browser_sources import browser_family''',
    '''from browser_commander.browser.browser_cookies import resolve_import_source
from browser_commander.browser.browser_profiles import (
    browser_profile_root,
    resolve_browser_profile,
)
from browser_commander.browser.browser_sources import (
    browser_family,
    is_single_profile_browser,
)
from browser_commander.browser.default_browser import RunCommand''',
)
s = sub(
    s,
    '''    if user_data_dir:
        # A Chromium profile lives in a named subdirectory; for Firefox the
        # user data dir already is the profile.
        if browser_family(browser) == "chromium":
            return Path(user_data_dir) / profile
        return Path(user_data_dir)
    if browser_family(browser) == "chromium":
        root = browser_profile_root(
            browser, platform=platform, home_dir=home_dir, environment=environment
        )
        if root is None:
            raise FileNotFoundError(f"{browser} has no profile directory on {platform}")
        return root / profile''',
    '''    # A Chromium profile lives in a named subdirectory of the user data dir,
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
        return root / profile if nests_profiles else root''',
)
s = sub(
    s,
    '''    home_dir: PathLike | None = None,
    environment: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Synchronous :func:`migrate_profile`; see it for the arguments."""''',
    '''    home_dir: PathLike | None = None,
    environment: Mapping[str, str] | None = None,
    run_command: RunCommand | None = None,
) -> dict[str, Any]:
    """Synchronous :func:`migrate_profile`; see it for the arguments."""''',
)
s = sub(
    s,
    '''    browser = resolve_source_browser(
        str(from_["browser"]), platform=platform, environment=env
    )
    profile_value = from_.get("profile")
    profile = "Default" if profile_value is None else str(profile_value)
    user_data_dir = from_.get("user_data_dir", from_.get("userDataDir"))''',
    '''    user_data_dir = from_.get("user_data_dir", from_.get("userDataDir"))
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
    profile = "Default" if profile_value is None else str(profile_value)''',
)
s = sub(
    s,
    '''        "warnings": [],
        "cookies": [],
    }
''',
    '''        "warnings": [],
        "cookies": [],
    }
    if source.warning is not None:
        report["warnings"].append(source.warning)
''',
)
s = sub(
    s,
    '''        home_dir: Home directory for profile discovery.
        environment: Environment for profile discovery and keyring lookups.
''',
    '''        home_dir: Home directory for profile discovery.
        environment: Environment for profile discovery and keyring lookups.
        run_command: Injected command runner for the default-browser lookup.
            With ``from_["browser"]`` ``default``/``auto`` and ``domains``, an
            import falls back from a default browser holding none of them to
            the installed profile holding the most, adding a
            ``default-browser-fallback`` warning.
''',
)
s = sub(
    s,
    '''        home_dir=home_dir,
        environment=environment,
    )
''',
    '''        home_dir=home_dir,
        environment=environment,
        run_command=run_command,
    )
''',
)
start = s.index("async def migrate_profile(")
end = s.index(") -> dict[str, Any]:", start)
signature = sub(
    s[start:end],
    "    environment: Mapping[str, str] | None = None,\n",
    "    environment: Mapping[str, str] | None = None,\n"
    "    run_command: RunCommand | None = None,\n",
)
s = s[:start] + signature + s[end:]
path.write_text(s)
print("ported")
