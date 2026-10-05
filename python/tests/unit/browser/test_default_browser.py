# feature-parity: sources.default-browser@native-typed
"""Default-browser resolution parity with ``js/src/browser/default-browser.js``."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from browser_commander.browser.default_browser import (
    browser_for_identifier,
    parse_mac_launch_services_handler,
    parse_windows_prog_id,
    resolve_default_browser,
)


def runner_returning(mapping: dict[str, str]):
    """A fake command runner keyed by ``"command arg arg"``."""

    def run(command: str, args: Sequence[str], _environment: Mapping[str, str]) -> str:
        key = " ".join([command, *args])
        if key not in mapping:
            raise RuntimeError(f"unexpected command: {key}")
        return mapping[key]

    return run


def test_maps_a_macos_launch_services_https_handler() -> None:
    output = """(
      {
        LSHandlerRoleAll = "com.apple.safari";
        LSHandlerURLScheme = mailto;
      },
      {
        LSHandlerRoleAll = "com.google.chrome";
        LSHandlerURLScheme = https;
      }
    )"""
    run_command = runner_returning(
        {
            "defaults read com.apple.LaunchServices/"
            "com.apple.launchservices.secure LSHandlers": output
        }
    )
    assert (
        resolve_default_browser(platform="darwin", run_command=run_command) == "chrome"
    )


def test_maps_a_linux_xdg_settings_desktop_name() -> None:
    run_command = runner_returning(
        {"xdg-settings get default-web-browser": "firefox.desktop\n"}
    )
    assert (
        resolve_default_browser(platform="linux", run_command=run_command) == "firefox"
    )


def test_falls_back_to_xdg_mime_when_xdg_settings_is_unknown() -> None:
    def run_command(
        command: str, args: Sequence[str], _environment: Mapping[str, str]
    ) -> str:
        key = " ".join([command, *args])
        if key == "xdg-settings get default-web-browser":
            return "some-unknown.desktop\n"
        if key == "xdg-mime query default x-scheme-handler/https":
            return "brave-browser.desktop\n"
        raise RuntimeError(f"unexpected command: {key}")

    assert resolve_default_browser(platform="linux", run_command=run_command) == "brave"


def test_maps_a_windows_user_choice_prog_id() -> None:
    output = "\r\n".join(
        [
            "",
            "HKEY_CURRENT_USER\\...\\https\\UserChoice",
            "    ProgId    REG_SZ    MSEdgeHTM",
            "",
        ]
    )
    run_command = runner_returning(
        {
            "reg query HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations"
            "\\UrlAssociations\\https\\UserChoice /v ProgId": output
        }
    )
    assert resolve_default_browser(platform="win32", run_command=run_command) == "edge"


def test_returns_none_when_nothing_matches_or_the_tool_fails() -> None:
    def failing(
        _command: str, _args: Sequence[str], _environment: Mapping[str, str]
    ) -> str:
        raise RuntimeError("no xdg")

    assert resolve_default_browser(platform="linux", run_command=failing) is None
    assert resolve_default_browser(platform="sunos", run_command=lambda *_a: "") is None


def test_parses_handler_blocks_and_prog_id_lines_directly() -> None:
    assert (
        parse_mac_launch_services_handler(
            '{ LSHandlerURLScheme = https; LSHandlerRoleAll = "com.brave.browser"; }'
        )
        == "com.brave.browser"
    )
    assert parse_windows_prog_id("  ProgId   REG_SZ   FirefoxHTML") == "FirefoxHTML"
    assert browser_for_identifier("COM.GOOGLE.CHROME", "darwin") == "chrome"
    assert browser_for_identifier("", "darwin") is None
