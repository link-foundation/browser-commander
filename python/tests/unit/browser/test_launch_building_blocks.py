"""Debugging port, profile directory and restriction helpers (#101, #103)."""

from __future__ import annotations

import json
import os
import socket
from pathlib import Path
from typing import Any

import pytest

from browser_commander.browser.connector import pick_foreground_page
from browser_commander.browser.debugging_port import (
    LOOPBACK_HOST,
    PortRaceError,
    assert_fixed_debugging_port,
    classify_dev_tools_ownership,
    parse_dev_tools_output,
    reserve_loopback_port,
    watch_dev_tools_output,
)
from browser_commander.browser.profile_directory import (
    FIRST_RUN_SENTINEL,
    LOCAL_STATE_FILE,
    TEMPORARY_PROFILE_PREFIX,
    create_temporary_user_data_dir,
    prepare_user_data_dir,
    remove_user_data_dir,
)
from browser_commander.browser.restrictions import (
    LAUNCH_RESTRICTION_PRESETS,
    LAUNCH_RESTRICTIONS,
    assert_string_array,
    browser_environment,
    merge_feature_switches,
    resolve_restrictions,
)
from browser_commander.fingerprint.automation_parity import (
    detect_automation_controlled_triggers,
)
from browser_commander.utilities.subprocess import OutputChannel

# -- debugging port ----------------------------------------------------------


def test_reserves_a_free_fixed_loopback_port() -> None:
    port = reserve_loopback_port()
    assert 1 <= port <= 65_535
    # The port was released, so the browser can bind it.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.bind((LOOPBACK_HOST, port))


def test_refuses_port_zero_with_the_reason() -> None:
    with pytest.raises(ValueError, match="AutomationControlled"):
        assert_fixed_debugging_port(0)
    for invalid in (True, 70_000, -5, "9222", None):
        with pytest.raises(ValueError, match="1 to 65535"):
            assert_fixed_debugging_port(invalid)
    assert assert_fixed_debugging_port(9222) == 9222


def test_port_race_error_names_the_port() -> None:
    error = PortRaceError(9333, "bind failed")
    assert error.port == 9333
    assert "9333" in str(error)
    assert "bind failed" in str(error)


def test_parses_the_listening_line() -> None:
    output = parse_dev_tools_output(
        "noise\nDevTools listening on ws://127.0.0.1:9333/devtools/browser/abc\n"
    )
    assert output.listening is not None
    assert output.listening.url == "ws://127.0.0.1:9333/devtools/browser/abc"
    assert output.listening.port == 9333
    assert output.listening.host == "127.0.0.1"
    assert classify_dev_tools_ownership(output, 9333) == "owned"
    assert classify_dev_tools_ownership(output, 9334) == "race"


def test_classifies_bind_failure_and_silence() -> None:
    failed = parse_dev_tools_output("Cannot start http server for devtools.")
    assert classify_dev_tools_ownership(failed, 9333) == "race"
    # A bare bind() failure can come from other sockets and proves nothing.
    unrelated = parse_dev_tools_output("bind() failed: Address already in use (98)")
    assert classify_dev_tools_ownership(unrelated, 9333) == "pending"
    ipv6 = parse_dev_tools_output(
        "DevTools listening on ws://[::1]:9333/devtools/browser/x"
    )
    assert ipv6.listening is not None
    assert ipv6.listening.host == "::1"
    assert classify_dev_tools_ownership(ipv6, 9333) == "race"


def test_watches_output_split_across_chunks() -> None:
    channel = OutputChannel()
    watcher = watch_dev_tools_output(channel)
    assert watcher.available
    channel.emit("DevTools listening on ws://127.0.0.1:93")
    assert watcher.state().listening is None
    channel.emit("33/devtools/browser/abc\n")
    listening = watcher.state().listening
    assert listening is not None
    assert listening.port == 9333
    assert watch_dev_tools_output(None).available is False


# -- profile directory -------------------------------------------------------


def test_creates_a_prepared_temporary_profile() -> None:
    directory = create_temporary_user_data_dir()
    try:
        assert Path(directory).name.startswith(TEMPORARY_PROFILE_PREFIX)
        assert (Path(directory) / FIRST_RUN_SENTINEL).is_file()
        local_state = json.loads((Path(directory) / LOCAL_STATE_FILE).read_text())
        assert local_state == {
            "browser": {
                "last_whats_new_version": 9999,
                "default_browser_infobar_declined_count": 5,
                "default_browser_declined_count": 5,
            },
            "fre": {"has_user_seen_fre": True},
        }
        assert json.loads(
            (Path(directory) / "Default" / "Preferences").read_text()
        ) == {"browser": {"check_default_browser": False}}
    finally:
        remove_user_data_dir(directory)
    assert not Path(directory).exists()
    # Removing an already removed profile is not an error.
    remove_user_data_dir(directory)


def test_prepare_leaves_existing_chrome_state_alone(tmp_path: Path) -> None:
    (tmp_path / LOCAL_STATE_FILE).write_text('{"mine": true}')
    assert prepare_user_data_dir(tmp_path) == os.fspath(tmp_path)
    assert json.loads((tmp_path / LOCAL_STATE_FILE).read_text()) == {
        "mine": True,
        "browser": {
            "default_browser_infobar_declined_count": 5,
            "default_browser_declined_count": 5,
        },
    }
    assert (tmp_path / FIRST_RUN_SENTINEL).is_file()


def test_profile_settings_merge_and_named_override(tmp_path: Path) -> None:
    prepare_user_data_dir(tmp_path)
    (tmp_path / "Default" / "Preferences").write_text(
        '{"browser":{"check_default_browser":true,"show_home_button":false},"intl":{"accept_languages":"en"}}'
    )
    prepare_user_data_dir(
        tmp_path,
        default_browser_check=False,
        preferences={"browser": {"show_home_button": True}},
        local_state={"browser": {"extra": 1}},
    )
    assert json.loads((tmp_path / "Default" / "Preferences").read_text()) == {
        "browser": {"check_default_browser": False, "show_home_button": True},
        "intl": {"accept_languages": "en"},
    }
    assert json.loads((tmp_path / LOCAL_STATE_FILE).read_text())["browser"] == {
        "last_whats_new_version": 9999,
        "default_browser_infobar_declined_count": 5,
        "default_browser_declined_count": 5,
        "extra": 1,
    }
    prepare_user_data_dir(tmp_path, default_browser_check=True)
    assert (
        json.loads((tmp_path / "Default" / "Preferences").read_text())["browser"][
            "check_default_browser"
        ]
        is True
    )
    assert (
        json.loads((tmp_path / LOCAL_STATE_FILE).read_text())["browser"][
            "default_browser_declined_count"
        ]
        == 0
    )


def test_first_run_can_be_enabled_in_a_fresh_profile(tmp_path: Path) -> None:
    prepare_user_data_dir(tmp_path, first_run=True)
    assert not (tmp_path / FIRST_RUN_SENTINEL).exists()


# -- restrictions ------------------------------------------------------------


def test_catalogue_and_presets() -> None:
    ids = {entry["id"] for entry in LAUNCH_RESTRICTIONS}
    for preset in LAUNCH_RESTRICTION_PRESETS.values():
        assert set(preset) <= ids
    assert {"no-sync", "no-extensions", "no-google-services"} <= ids


def test_resolves_a_preset_into_switches_and_environment() -> None:
    resolved = resolve_restrictions(["legacy-launch-browser"])
    assert "--no-first-run" in resolved.args
    assert "--disable-features=Translate" in resolved.args
    assert resolved.env == {
        "GOOGLE_API_KEY": "no",
        "GOOGLE_DEFAULT_CLIENT_ID": "no",
        "GOOGLE_DEFAULT_CLIENT_SECRET": "no",
    }
    assert resolve_restrictions().args == []


def test_no_restriction_turns_automation_controlled_on() -> None:
    every = [entry["id"] for entry in LAUNCH_RESTRICTIONS]
    assert detect_automation_controlled_triggers(resolve_restrictions(every).args) == []


def test_rejects_unknown_names_and_non_lists() -> None:
    with pytest.raises(ValueError, match='Unknown launch restriction "nope"'):
        resolve_restrictions(["nope"])
    with pytest.raises(TypeError, match="restrictions must be a list of strings"):
        resolve_restrictions("no-sync")
    with pytest.raises(TypeError, match="args must be a list of strings"):
        assert_string_array(["--ok", 1], "args")


def test_merges_repeated_feature_switches() -> None:
    assert merge_feature_switches(
        [
            "--disable-features=A,B",
            "--lang=en",
            "--disable-features=B,C",
            "--enable-blink-features=X",
            "--enable-blink-features=Y",
        ]
    ) == [
        "--disable-features=A,B,C",
        "--lang=en",
        "--enable-blink-features=X,Y",
    ]


def test_browser_environment_never_touches_os_environ(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    assert browser_environment() is None
    env = browser_environment(["no-google-services"], {"EXTRA": "1"})
    assert env is not None
    assert env["GOOGLE_API_KEY"] == "no"
    assert env["EXTRA"] == "1"
    assert env["PATH"] == os.environ["PATH"]
    assert "GOOGLE_API_KEY" not in os.environ


# -- pick_foreground_page ----------------------------------------------------


class _Page:
    def __init__(self, state: Any) -> None:
        self.state = state

    async def evaluate(self, _expression: str) -> Any:
        if isinstance(self.state, Exception):
            raise self.state
        return self.state


async def test_picks_the_visible_page() -> None:
    hidden, broken, visible = (
        _Page("hidden"),
        _Page(RuntimeError("detached")),
        _Page("visible"),
    )
    assert await pick_foreground_page([hidden, broken, visible]) is visible
    assert await pick_foreground_page([hidden, broken]) is hidden
    assert await pick_foreground_page([]) is None
