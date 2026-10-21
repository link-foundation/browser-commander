# feature-parity: launch.chrome-for-testing@native-typed
"""Chrome for Testing in the download caches (issue #179)."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from browser_commander.browser import launch_executable
from browser_commander.browser.chrome_for_testing_cache import (
    cache_locations,
    cached_chrome_for_testing,
    chrome_for_testing_candidates,
)
from browser_commander.browser.launch_executable import (
    bundled_chrome_for_testing,
    is_chrome_for_testing,
)

if TYPE_CHECKING:
    import pytest


def install(home: Path, relative: str) -> str:
    file = home / relative
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text("#!/bin/sh\n")
    file.chmod(0o755)
    return str(file)


def linux(home: Path, **env: str):
    return cache_locations(platform="linux", arch="x86_64", home=home, env=env)


def test_lists_the_playwright_builds_newest_revision_first(tmp_path: Path) -> None:
    old = install(tmp_path, ".cache/ms-playwright/chromium-999/chrome-linux64/chrome")
    new = install(tmp_path, ".cache/ms-playwright/chromium-1248/chrome-linux64/chrome")
    (tmp_path / ".cache/ms-playwright/chromium_headless_shell-1300").mkdir()
    assert chrome_for_testing_candidates("playwright", linux(tmp_path)) == [new, old]


def test_follows_playwright_browsers_path_and_xdg_cache_home(tmp_path: Path) -> None:
    moved = install(tmp_path, "moved/chromium-1300/chrome-linux64/chrome")
    moved_root = str(tmp_path / "moved")
    assert chrome_for_testing_candidates(
        "playwright", linux(tmp_path, PLAYWRIGHT_BROWSERS_PATH=moved_root)
    ) == [moved]
    assert (
        chrome_for_testing_candidates(
            "playwright", linux(tmp_path, PLAYWRIGHT_BROWSERS_PATH="0")
        )
        == []
    )
    xdg = install(tmp_path, "xdg/ms-playwright/chromium-1/chrome-linux64/chrome")
    assert chrome_for_testing_candidates(
        "playwright", linux(tmp_path, XDG_CACHE_HOME=str(tmp_path / "xdg"))
    ) == [xdg]


def test_compares_puppeteer_and_selenium_versions_numerically(tmp_path: Path) -> None:
    newer = install(
        tmp_path, ".cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome"
    )
    older = install(
        tmp_path, ".cache/puppeteer/chrome/linux-99.0.1.1/chrome-linux64/chrome"
    )
    assert chrome_for_testing_candidates("puppeteer", linux(tmp_path)) == [
        newer,
        older,
    ]
    selenium = install(tmp_path, ".cache/selenium/chrome/linux64/131.0.6778.85/chrome")
    assert chrome_for_testing_candidates("selenium", linux(tmp_path)) == [selenium]
    assert all(is_chrome_for_testing(file) for file in (newer, older, selenium))


def test_searches_the_caches_each_engine_uses_in_order(tmp_path: Path) -> None:
    playwright = install(
        tmp_path, ".cache/ms-playwright/chromium-1248/chrome-linux64/chrome"
    )
    puppeteer = install(
        tmp_path, ".cache/puppeteer/chrome/linux-131.0.6778.85/chrome-linux64/chrome"
    )
    selenium = install(tmp_path, ".cache/selenium/chrome/linux64/131.0.6778.85/chrome")
    locations = linux(tmp_path)
    assert cached_chrome_for_testing("playwright", locations) == [playwright]
    assert cached_chrome_for_testing("selenium", locations) == [
        playwright,
        puppeteer,
        selenium,
    ]


def test_knows_the_macos_and_windows_layouts_and_skips_others(tmp_path: Path) -> None:
    mac = cache_locations(platform="darwin", arch="arm64", home=tmp_path, env={})
    assert mac is not None and mac.name == "mac-arm64"
    assert mac.root("playwright") == tmp_path / "Library" / "Caches" / "ms-playwright"
    windows = cache_locations(platform="win32", arch="x86", home=tmp_path, env={})
    assert windows is not None and windows.puppeteer == "win32"
    assert (
        cache_locations(platform="linux", arch="aarch64", home=tmp_path, env={}) is None
    )


async def test_falls_back_to_a_cached_build_when_playwrights_own_is_missing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    async def missing() -> str:
        return "/nonexistent/chromium-1243/chrome-linux64/chrome"

    cached = install(tmp_path, "chromium-1248/chrome-linux64/chrome")
    monkeypatch.setattr(launch_executable, "_playwright_executable", missing)
    asked: list[str] = []

    def caches(engine: str) -> list[str]:
        asked.append(engine)
        return ["/nonexistent/chrome-linux64/chrome", cached]

    assert await bundled_chrome_for_testing("playwright", cached=caches) == cached
    assert await bundled_chrome_for_testing("playwright", cached=lambda _: []) is None
    assert asked == ["playwright"]
