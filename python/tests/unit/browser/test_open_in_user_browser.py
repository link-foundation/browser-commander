"""Unit tests for open_in_user_browser (mirrors open-in-user-browser.test.js)."""

from __future__ import annotations

from typing import Any

import pytest

import browser_commander
from browser_commander.browser.open_in_user_browser import (
    build_open_command,
    open_in_user_browser,
    validate_open_url,
)


def _recording_runner() -> tuple[list[dict[str, Any]], Any]:
    calls: list[dict[str, Any]] = []

    async def runner(file: str, args: list[str], **options: Any) -> dict[str, Any]:
        calls.append({"file": file, "args": args, "options": options})
        return {"stdout": "", "stderr": "", "code": 0}

    return calls, runner


# validate_open_url -----------------------------------------------------------


def test_accepts_http_https_and_file_urls() -> None:
    assert validate_open_url("https://example.com/") == "https://example.com/"
    assert validate_open_url("http://example.com") == "http://example.com"
    assert validate_open_url("file:///tmp/x.html") == "file:///tmp/x.html"


@pytest.mark.parametrize("url", ["--version", "-e"])
def test_rejects_strings_that_could_be_parsed_as_an_option(url: str) -> None:
    with pytest.raises(ValueError, match='cannot start with "-"'):
        validate_open_url(url)


def test_rejects_non_url_strings_and_disallowed_schemes() -> None:
    with pytest.raises(ValueError, match="not a valid absolute URL"):
        validate_open_url("not a url")
    with pytest.raises(ValueError, match="is not one of"):
        validate_open_url("javascript:alert(1)")
    with pytest.raises(TypeError, match="requires a URL string"):
        validate_open_url("")
    with pytest.raises(TypeError, match="requires a URL string"):
        validate_open_url(None)


# build_open_command ----------------------------------------------------------


def test_uses_open_on_macos() -> None:
    assert build_open_command("https://x.dev/", "darwin") == ["open", "https://x.dev/"]


def test_uses_xdg_open_on_linux() -> None:
    assert build_open_command("https://x.dev/", "linux") == [
        "xdg-open",
        "https://x.dev/",
    ]


def test_uses_cmd_start_on_windows_with_an_empty_title_argument() -> None:
    assert build_open_command("https://x.dev/", "win32") == [
        "cmd",
        "/c",
        "start",
        "",
        "https://x.dev/",
    ]


def test_throws_on_an_unsupported_platform() -> None:
    with pytest.raises(ValueError, match="not supported"):
        build_open_command("https://x.dev/", "sunos")


# open_in_user_browser --------------------------------------------------------


@pytest.mark.parametrize("platform", ["darwin", "linux", "win32"])
async def test_runs_the_platform_opener_and_returns_the_command(platform: str) -> None:
    calls, runner = _recording_runner()
    result = await open_in_user_browser(
        "https://example.com/", platform=platform, runner=runner
    )
    expected = build_open_command("https://example.com/", platform)
    assert result["opened"] == "https://example.com/"
    assert result["command"] == expected
    assert len(calls) == 1
    assert calls[0]["file"] == expected[0]
    assert calls[0]["args"] == expected[1:]
    assert calls[0]["options"] == {}


async def test_passes_env_through_to_the_runner_when_provided() -> None:
    calls, runner = _recording_runner()
    await open_in_user_browser(
        "https://example.com/", platform="linux", runner=runner, env={"DISPLAY": ":1"}
    )
    assert calls[0]["options"] == {"env": {"DISPLAY": ":1"}}


async def test_accepts_a_synchronous_runner() -> None:
    calls: list[Any] = []
    result = await open_in_user_browser(
        "https://example.com/",
        platform="darwin",
        runner=lambda file, args: calls.append((file, args)),
    )
    assert calls == [("open", ["https://example.com/"])]
    assert result["command"] == ["open", "https://example.com/"]


async def test_validates_before_running() -> None:
    calls, runner = _recording_runner()
    with pytest.raises(ValueError, match='cannot start with "-"'):
        await open_in_user_browser("-e", platform="linux", runner=runner)
    assert calls == []


def test_is_exported_from_the_package_entry_point() -> None:
    assert browser_commander.open_in_user_browser is open_in_user_browser
    assert browser_commander.validate_open_url is validate_open_url
    assert browser_commander.build_open_command is build_open_command
