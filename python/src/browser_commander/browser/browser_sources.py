"""Catalogue of installed browsers Browser Commander can import from (#114).

The data lives in ``browser-sources.json``, a shared asset JavaScript, Python
and Rust duplicate byte-for-byte (checked by
``scripts/check-shared-fingerprint-assets.sh``). This module turns that data
into the lookups the rest of the browser code needs: canonical ids with their
aliases, the per-platform profile roots, the Chromium Safe Storage identity,
and the operating-system identifiers that mark a browser as the system default.

Keeping it data-driven is what lets a single JSON edit add Opera, Vivaldi, Arc,
a Firefox fork or a Chrome channel to all three implementations at once, rather
than touching hand-written per-platform maps in each language.
"""

from __future__ import annotations

import json
import ntpath
import os
import posixpath
import re
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from types import MappingProxyType
from typing import Any

_REGISTRY_PATH = Path(__file__).with_name("browser-sources.json")
_REGISTRY = json.loads(_REGISTRY_PATH.read_text(encoding="utf-8"))

#: Every known browser, in catalogue order, as read-only mappings.
BROWSER_SOURCES: tuple[Mapping[str, Any], ...] = tuple(
    MappingProxyType(browser) for browser in _REGISTRY["browsers"]
)

#: Canonical ids, in catalogue order.
BROWSER_IDS: tuple[str, ...] = tuple(browser["id"] for browser in BROWSER_SOURCES)

_BY_NAME: dict[str, Mapping[str, Any]] = {}
for _browser in BROWSER_SOURCES:
    _BY_NAME[_browser["id"]] = _browser
    for _alias in _browser.get("aliases", ()):
        _BY_NAME[_alias] = _browser

_TEMPLATE = re.compile(r"^\{(\w+)\}(.*)$")


def _path_module(platform: str) -> Any:
    return ntpath if platform == "win32" else posixpath


def find_browser_source(name: Any) -> Mapping[str, Any] | None:
    """Resolve a name (canonical id or alias) to its catalogue entry."""
    if not isinstance(name, str):
        return None
    return _BY_NAME.get(name) or _BY_NAME.get(name.lower())


def _normalize_source(name: Any) -> Mapping[str, Any]:
    source = find_browser_source(name)
    if source is None:
        expected = ", ".join(BROWSER_IDS)
        raise ValueError(f"Unsupported browser: {name}. Expected one of {expected}")
    return source


def normalize_browser_id(name: Any) -> str:
    """Resolve a name to its canonical id, raising a readable error otherwise."""
    return _normalize_source(name)["id"]


def browser_family(name: Any) -> str:
    """Return the family (``chromium`` or ``firefox``) of a browser name."""
    return _normalize_source(name)["family"]


def _template_variables(
    platform: str, home: str, environment: Mapping[str, str], path_module: Any
) -> dict[str, str]:
    if platform == "darwin":
        return {
            "home": home,
            "appSupport": path_module.join(home, "Library", "Application Support"),
        }
    if platform == "win32":
        local = environment.get("LOCALAPPDATA")
        if local is None:
            local = path_module.join(home, "AppData", "Local")
        roaming = environment.get("APPDATA")
        if roaming is None:
            roaming = path_module.join(home, "AppData", "Roaming")
        return {
            "home": home,
            "localAppData": local,
            "appData": roaming,
            "programFiles": environment.get("PROGRAMFILES", ""),
            "programFilesX86": environment.get("PROGRAMFILES(X86)", ""),
        }
    config = environment.get("XDG_CONFIG_HOME")
    if config is None:
        config = path_module.join(home, ".config")
    return {"home": home, "config": config}


def _expand_template(
    template: str, variables: Mapping[str, str], path_module: Any
) -> str | None:
    match = _TEMPLATE.match(template)
    if not match:
        return template
    base = variables.get(match.group(1))
    if not base:
        return None
    rest = [part for part in match.group(2).split("/") if part]
    return path_module.join(base, *rest)


def resolve_browser_roots(
    name: Any,
    *,
    platform: str = sys.platform,
    home_dir: str | os.PathLike[str] | None = None,
    environment: Mapping[str, str] | None = None,
) -> list[str]:
    """Return the absolute profile roots a browser uses on a platform.

    Returns an empty list when the browser does not run on that platform (for
    example Chrome Canary on Linux).
    """
    source = _normalize_source(name)
    templates: Sequence[str] = source.get("roots", {}).get(platform, [])
    path_module = _path_module(platform)
    home = str(Path.home()) if home_dir is None else os.fspath(home_dir)
    env = os.environ if environment is None else environment
    variables = _template_variables(platform, home, env, path_module)
    roots: list[str] = []
    for template in templates:
        resolved = _expand_template(template, variables, path_module)
        if resolved is not None:
            roots.append(resolved)
    return roots


def resolve_browser_executables(
    name: Any,
    *,
    platform: str = sys.platform,
    home_dir: str | os.PathLike[str] | None = None,
    environment: Mapping[str, str] | None = None,
) -> list[str]:
    """Resolve executable declarations and PATH candidates from the catalogue."""
    source = _normalize_source(name)
    env = os.environ if environment is None else environment
    path_module = _path_module(platform)
    home = str(Path.home()) if home_dir is None else os.fspath(home_dir)
    variables = _template_variables(platform, home, env, path_module)
    candidates = [
        resolved
        for template in source.get("executables", {}).get(platform, [])
        if (resolved := _expand_template(template, variables, path_module))
    ]
    for directory in env.get("PATH", "").split(
        ";" if platform == "win32" else os.pathsep
    ):
        if directory:
            for executable in source.get("executableNames", []):
                candidates.append(
                    path_module.join(
                        directory, executable + (".exe" if platform == "win32" else "")
                    )
                )
    return list(dict.fromkeys(candidates))


def is_single_profile_browser(name: Any) -> bool:
    """Return whether a browser stores one profile in the root (Opera-style)."""
    return _normalize_source(name).get("singleProfile") is True


def safe_storage_identity(name: Any) -> Mapping[str, str] | None:
    """Return the Chromium Safe Storage identity, or ``None`` for Firefox."""
    return _normalize_source(name).get("safeStorage")


def default_browser_identifiers(name: Any, platform: str) -> list[str]:
    """Return the OS identifiers that mark a browser as the system default.

    macOS bundle ids, Linux ``.desktop`` file names, or Windows ProgIds.
    """
    return list(_normalize_source(name).get("default", {}).get(platform, []))


__all__ = [
    "BROWSER_IDS",
    "BROWSER_SOURCES",
    "browser_family",
    "default_browser_identifiers",
    "find_browser_source",
    "is_single_profile_browser",
    "normalize_browser_id",
    "resolve_browser_roots",
    "safe_storage_identity",
]
