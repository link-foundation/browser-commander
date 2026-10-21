"""Finding Chrome for Testing in the download caches (issue #179).

The engine's own executable path names one exact build; when that build is
not installed, a launch still starts another Chrome for Testing the
Playwright, Puppeteer or Selenium Manager caches hold, newest version first.
Mirrors ``CacheLocations`` in ``rust/src/browser/chrome_for_testing.rs`` and
``js/src/browser/chrome-for-testing-cache.js``.
"""

from __future__ import annotations

import os
import platform as host_platform
import re
import sys
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path, PurePath

#: The caches each engine finds Chrome for Testing in, in order.
ENGINE_CACHES: dict[str, tuple[str, ...]] = {
    "playwright": ("playwright",),
    "puppeteer": ("puppeteer",),
    "selenium": ("playwright", "puppeteer", "selenium"),
}

# (archive and Selenium cache platform, Puppeteer's directory prefix)
_PLATFORMS = {
    "linux-x64": ("linux64", "linux"),
    "darwin-x64": ("mac-x64", "mac"),
    "darwin-arm64": ("mac-arm64", "mac_arm"),
    "win32-x64": ("win64", "win64"),
    "win32-ia32": ("win32", "win32"),
}
_VERSION = re.compile(r"^\d+(\.\d+)*$")


@dataclass(frozen=True)
class CacheLocations:
    """Where the download caches are on a machine."""

    platform: str
    name: str
    puppeteer: str
    home: Path | None
    env: Mapping[str, str]

    def _var(self, name: str) -> Path | None:
        value = self.env.get(name)
        return Path(value) if value else None

    def _home(self, *relative: str) -> Path | None:
        return self.home.joinpath(*relative) if self.home else None

    def root(self, cache: str) -> Path | None:
        """The directory ``cache`` keeps its browsers in."""

        if cache == "puppeteer":
            return self._var("PUPPETEER_CACHE_DIR") or self._home(".cache", "puppeteer")
        if cache == "selenium":
            return self._var("SE_CACHE_PATH") or self._home(".cache", "selenium")
        moved = self.env.get("PLAYWRIGHT_BROWSERS_PATH")
        if moved:
            # ``0`` keeps the browsers inside the package, where only
            # Playwright itself knows the path.
            return None if moved == "0" else Path(moved)
        if self.platform == "win32":
            local = self._var("LOCALAPPDATA")
            return local / "ms-playwright" if local else None
        if self.platform == "darwin":
            return self._home("Library", "Caches", "ms-playwright")
        xdg = self._var("XDG_CACHE_HOME")
        return xdg / "ms-playwright" if xdg else self._home(".cache", "ms-playwright")

    def binary(self) -> PurePath:
        """The binary inside an unpacked Chrome for Testing directory."""

        if self.platform == "darwin":
            return PurePath(
                "Google Chrome for Testing.app",
                "Contents",
                "MacOS",
                "Google Chrome for Testing",
            )
        return PurePath("chrome.exe" if self.platform == "win32" else "chrome")


def _platform_key(platform: str, arch: str) -> str:
    if platform == "darwin":
        return "darwin-arm64" if arch in ("arm64", "aarch64") else "darwin-x64"
    if platform == "win32":
        return "win32-ia32" if arch in ("x86", "i386", "i686") else "win32-x64"
    return f"{platform}-{'x64' if arch in ('x86_64', 'amd64', 'x64') else arch}"


def cache_locations(
    *,
    platform: str | None = None,
    arch: str | None = None,
    home: Path | str | None = None,
    env: Mapping[str, str] | None = None,
) -> CacheLocations | None:
    """The caches of a machine (this one by default), or ``None`` where
    Chrome for Testing is not built for the platform."""

    platform = platform or (
        "linux" if sys.platform.startswith("linux") else sys.platform
    )
    arch = (arch or host_platform.machine()).lower()
    known = _PLATFORMS.get(_platform_key(platform, arch))
    if known is None:
        return None
    if home is None:
        try:
            home = Path.home()
        except RuntimeError:
            home = None
    return CacheLocations(
        platform=platform,
        name=known[0],
        puppeteer=known[1],
        home=Path(home) if home is not None else None,
        env=os.environ if env is None else env,
    )


def _version_key(text: str) -> tuple[int, ...] | None:
    return (
        tuple(int(part) for part in text.split(".")) if _VERSION.match(text) else None
    )


def _with_prefix(prefix: str) -> Callable[[str], tuple[int, ...] | None]:
    return lambda name: (
        _version_key(name[len(prefix) :]) if name.startswith(prefix) else None
    )


def _newest_first(
    root: Path, key: Callable[[str], tuple[int, ...] | None]
) -> list[Path]:
    try:
        entries = list(root.iterdir())
    except OSError:
        return []
    versions = [
        (version, entry)
        for entry in entries
        if (version := key(entry.name)) is not None and entry.is_dir()
    ]
    versions.sort(key=lambda item: item[0], reverse=True)
    return [entry for _, entry in versions]


def chrome_for_testing_candidates(cache: str, locations: CacheLocations) -> list[str]:
    """The Chrome for Testing binaries ``cache`` may hold, newest first.

    The paths are candidates: the caller checks that they exist.
    """

    root = locations.root(cache)
    if root is None:
        return []
    archive = f"chrome-{locations.name}"
    binary = locations.binary()
    if cache == "selenium":
        directories = _newest_first(root / "chrome" / locations.name, _version_key)
        return [str(directory / binary) for directory in directories]
    if cache == "playwright":
        directories = _newest_first(root, _with_prefix("chromium-"))
    else:
        directories = _newest_first(
            root / "chrome", _with_prefix(f"{locations.puppeteer}-")
        )
    return [str(directory / archive / binary) for directory in directories]


def cached_chrome_for_testing(
    engine: str, locations: CacheLocations | None = None
) -> list[str]:
    """The Chrome for Testing candidates in the caches ``engine`` uses."""

    locations = locations or cache_locations()
    if locations is None:
        return []
    return [
        candidate
        for cache in ENGINE_CACHES.get(engine, ())
        for candidate in chrome_for_testing_candidates(cache, locations)
    ]
