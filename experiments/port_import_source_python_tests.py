"""One-off edit script: Python fixtures, tests and exports for import sources (#114)."""

import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent / "python"


def edit(relative, *pairs):
    path = ROOT / relative
    text = path.read_text()
    for old, new in pairs:
        assert old in text, (relative, old)
        text = text.replace(old, new, 1)
    path.write_text(text)


edit(
    "tests/helpers/migration_fixtures.py",
    (
        '''    return cookie_path


def write_firefox_places(''',
        '''    return cookie_path


def write_firefox_profile(
    home: Path,
    rows: Iterable[Mapping[str, Any]],
    *,
    root: str = ".mozilla/firefox",
    name: str = "default-release",
) -> Path:
    """Write a Linux Firefox-family install under ``home`` with one profile.

    The profile is listed as the default in ``profiles.ini`` and its
    ``cookies.sqlite`` holds ``rows``. ``root`` is the install root relative to
    ``home`` (a fork such as LibreWolf uses its own); returns the profile dir.
    """

    root_path = home.joinpath(*root.split("/"))
    profile_name = f"xyz.{name}"
    profile_path = root_path / profile_name
    profile_path.mkdir(parents=True)
    (root_path / "profiles.ini").write_text(
        f"[Profile0]\\nName={name}\\nIsRelative=1\\nPath={profile_name}\\nDefault=1\\n",
        encoding="utf-8",
    )
    write_firefox_cookies(profile_path, rows)
    return profile_path


def write_firefox_places(''',
    ),
)

edit(
    "tests/unit/browser/test_browser_profiles_sources.py",
    (
        '''from tests.helpers.migration_fixtures import write_firefox_cookies


def _write_firefox_profile(home: Path, root_name: tuple[str, ...]) -> Path:
    root = home.joinpath(*root_name)
    profile_name = "xyz.default-release"
    profile_path = root / profile_name
    profile_path.mkdir(parents=True)
    (root / "profiles.ini").write_text(
        f"[Profile0]\\nName=default-release\\nIsRelative=1\\n"
        f"Path={profile_name}\\nDefault=1\\n",
        encoding="utf-8",
    )
    write_firefox_cookies(
        profile_path, [{"name": "a", "value": "1", "host": ".example.com"}]
    )
    return profile_path
''',
        '''from tests.helpers.migration_fixtures import write_firefox_profile

_COOKIES = [{"name": "a", "value": "1", "host": ".example.com"}]
''',
    ),
    (
        '''    root = tmp_path / ".librewolf"
    profile_name = "abcd.default"
    profile_path = root / profile_name
    profile_path.mkdir(parents=True)
    (root / "profiles.ini").write_text(
        f"[Profile0]\\nName=default\\nIsRelative=1\\nPath={profile_name}\\nDefault=1\\n",
        encoding="utf-8",
    )
    write_firefox_cookies(
        profile_path, [{"name": "a", "value": "1", "host": ".example.com"}]
    )
''',
        '''    profile_path = write_firefox_profile(
        tmp_path, _COOKIES, root=".librewolf", name="default"
    )
''',
    ),
    (
        '''    _write_firefox_profile(tmp_path, (".mozilla", "firefox"))
''',
        '''    write_firefox_profile(tmp_path, _COOKIES)
''',
    ),
    (
        '''    profile_path = _write_firefox_profile(tmp_path, (".mozilla", "firefox"))
''',
        '''    profile_path = write_firefox_profile(tmp_path, _COOKIES)
''',
    ),
)

edit(
    "tests/unit/browser/test_cookie_sources.py",
    (
        '''from browser_commander.browser.browser_cookies import list_cookie_sources
from tests.helpers.migration_fixtures import write_firefox_cookies


def _make_firefox_profile(home: Path, cookies: list[dict]) -> Path:
    root = home / ".mozilla" / "firefox"
    profile_name = "xyz.default-release"
    profile_path = root / profile_name
    profile_path.mkdir(parents=True)
    (root / "profiles.ini").write_text(
        f"[Profile0]\\nName=default-release\\nIsRelative=1\\n"
        f"Path={profile_name}\\nDefault=1\\n",
        encoding="utf-8",
    )
    write_firefox_cookies(profile_path, cookies)
    return profile_path
''',
        '''import pytest

from browser_commander.browser.browser_cookies import (
    ImportSource,
    list_cookie_sources,
    resolve_import_source,
)
from tests.helpers.migration_fixtures import write_firefox_profile
''',
    ),
    ("    profile_path = _make_firefox_profile(\n", "    profile_path = write_firefox_profile(\n"),
    ("    _make_firefox_profile(\n", "    write_firefox_profile(\n"),
)

path = ROOT / "tests/unit/browser/test_cookie_sources.py"
path.write_text(
    path.read_text()
    + '''

_GITHUB_COOKIE = [{"name": "a", "value": "1", "host": ".github.com"}]
_OTHER_COOKIE = [{"name": "b", "value": "2", "host": ".other.test"}]


def _firefox_is_default(*_args: object) -> str:
    return "firefox.desktop\\n"


def _no_default(*_args: object) -> str:
    raise RuntimeError("no xdg")


def _resolve(home: Path, **overrides: object) -> ImportSource:
    options: dict = {
        "domains": ["github.com"],
        "platform": "linux",
        "home_dir": home,
        "environment": {},
        "run_command": _firefox_is_default,
    }
    options.update(overrides)
    browser = options.pop("browser", "default")
    return resolve_import_source(browser, **options)


def test_import_source_keeps_the_system_default_when_it_holds_the_domains(
    tmp_path: Path,
) -> None:
    write_firefox_profile(tmp_path, _GITHUB_COOKIE)
    write_firefox_profile(tmp_path, _GITHUB_COOKIE, root=".librewolf", name="default")

    assert _resolve(tmp_path) == ImportSource(
        browser="firefox", profile="default-release", warning=None
    )


def test_import_source_falls_back_to_the_browser_that_holds_the_domains(
    tmp_path: Path,
) -> None:
    write_firefox_profile(tmp_path, _OTHER_COOKIE)
    write_firefox_profile(tmp_path, _GITHUB_COOKIE, root=".librewolf", name="default")

    source = _resolve(tmp_path)
    assert source.browser == "librewolf"
    assert source.profile == "default"
    assert source.warning is not None
    assert source.warning["reason"] == "default-browser-fallback"
    assert source.warning["item"] == "librewolf"
    assert (
        "default browser (firefox) holds no cookies for github.com; "
        "imported from librewolf" in source.warning["detail"]
    )


def test_import_source_falls_back_when_the_default_is_unknown(tmp_path: Path) -> None:
    home = tmp_path / "home"
    write_firefox_profile(home, _GITHUB_COOKIE, root=".librewolf", name="default")

    source = _resolve(home, run_command=_no_default)
    assert source.browser == "librewolf"
    assert source.warning is not None
    assert source.warning["reason"] == "default-browser-unknown"
    with pytest.raises(ValueError, match="no installed browser holds cookies"):
        _resolve(tmp_path / "empty", run_command=_no_default)


def test_import_source_resolves_the_default_plainly_without_domains(
    tmp_path: Path,
) -> None:
    assert _resolve(tmp_path, domains=None) == ImportSource(browser="firefox")
    assert _resolve(tmp_path, browser="Opera") == ImportSource(browser="opera")
'''
)

for relative in (
    "src/browser_commander/__init__.py",
    "src/browser_commander/exports.py",
    "src/browser_commander/browser/__init__.py",
):
    path = ROOT / relative
    text = path.read_text()
    assert text.count("    CookieSource,\n") == 1, relative
    text = text.replace("    CookieSource,\n", "    CookieSource,\n    ImportSource,\n", 1)
    assert text.count("    list_cookie_sources,\n") == 1, relative
    text = text.replace(
        "    list_cookie_sources,\n",
        "    list_cookie_sources,\n    resolve_import_source,\n",
        1,
    )
    assert text.count('    "CookieSource",\n') == 1, relative
    text = text.replace('    "CookieSource",\n', '    "CookieSource",\n    "ImportSource",\n', 1)
    assert text.count('    "list_cookie_sources",\n') == 1, relative
    text = text.replace(
        '    "list_cookie_sources",\n',
        '    "list_cookie_sources",\n    "resolve_import_source",\n',
        1,
    )
    path.write_text(text)
print("done")
