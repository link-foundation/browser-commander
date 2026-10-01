"""Unit tests for browser_commander.browser.parity (mirrors parity.test.js)."""

from __future__ import annotations

import time
from typing import Any

from browser_commander import (
    classify_differences,
    compare_command_lines,
    measure_parity,
    parse_switches,
)
from browser_commander.parity import diff_reports

# feature-parity: parity.measure@native-typed
CHROME = "/opt/google/chrome/chrome"


# ---------------------------------------------------------------------------
# Parsing a chrome://version command line
# ---------------------------------------------------------------------------


def test_splits_switches_and_drops_the_executable_and_start_url() -> None:
    switches = parse_switches(
        f"{CHROME} --user-data-dir=/tmp/a --ozone-platform=x11 "
        "--flag-switches-begin --flag-switches-end about:blank"
    )
    assert list(switches.items()) == [
        ("--user-data-dir", "/tmp/a"),
        ("--ozone-platform", "x11"),
        ("--flag-switches-begin", None),
        ("--flag-switches-end", None),
    ]


def test_keeps_a_value_that_contains_spaces_and_drops_only_a_trailing_url() -> None:
    assert list(
        parse_switches(
            f"{CHROME} --user-data-dir=/tmp/My Profile --flag data:text/html,hi"
        ).items()
    ) == [("--user-data-dir", "/tmp/My Profile"), ("--flag", None)]
    assert list(parse_switches(f"{CHROME} --enable-features=A,B").items()) == [
        ("--enable-features", "A,B")
    ]


def test_stays_linear_on_a_long_run_of_whitespace() -> None:
    started = time.monotonic()
    parse_switches(f"--a{' ' * 200000}x")
    assert time.monotonic() - started < 1


def test_accepts_an_argument_list() -> None:
    assert parse_switches(["--headless=new", "https://example.com"]) == {
        "--headless": "new"
    }


# ---------------------------------------------------------------------------
# Comparing command lines
# ---------------------------------------------------------------------------


def test_reports_only_what_the_reference_browser_did_not_have() -> None:
    comparison = compare_command_lines(
        f"{CHROME} --user-data-dir=/tmp/a --remote-debugging-port=41000 "
        "--ozone-platform=x11 about:blank",
        f"{CHROME} --user-data-dir=/tmp/b --remote-debugging-port=42000 "
        "--disable-sync --ozone-platform=x11 --flag-switches-begin "
        "--flag-switches-end about:blank",
    )
    assert comparison["extra"] == ["--disable-sync"]
    assert comparison["missing"] == []
    assert comparison["changed"] == []
    # The port is how the library attaches; it is not a difference.
    assert comparison["attachment"] == ["--remote-debugging-port=42000"]


def test_reports_missing_and_changed_switches_and_feature_lists() -> None:
    comparison = compare_command_lines(
        ["--user-data-dir=/tmp/a", "--lang=de", "--mute-audio"],
        ["--user-data-dir=/tmp/b", "--lang=en", "--disable-features=B,A"],
    )
    assert comparison["missing"] == ["--mute-audio"]
    assert comparison["changed"] == [
        {"name": "--lang", "reference": "de", "candidate": "en"}
    ]
    assert comparison["features"] == {
        "--disable-features": {"reference": [], "candidate": ["A", "B"]}
    }


# ---------------------------------------------------------------------------
# Explaining differences
# ---------------------------------------------------------------------------

EXTRA_SWITCH = {
    "path": "commandLine.extra.--disable-sync",
    "reference": None,
    "candidate": "--disable-sync",
}


def test_leaves_an_unexplained_difference_unlisted() -> None:
    result = classify_differences(
        [EXTRA_SWITCH], {"launch": "real", "requested_args": []}
    )
    assert result["unlisted"] == [
        {
            "path": "commandLine.extra.--disable-sync",
            "expected": None,
            "actual": "--disable-sync",
            "limitation": None,
            "requested": False,
        }
    ]


def test_accepts_a_switch_the_caller_asked_for() -> None:
    result = classify_differences(
        [EXTRA_SWITCH], {"launch": "real", "requested_args": ["--disable-sync"]}
    )
    assert result["differences"][0]["requested"] is True
    assert result["unlisted"] == []


def test_accepts_the_javascript_context_keys() -> None:
    result = classify_differences(
        [EXTRA_SWITCH], {"launch": "real", "requestedArgs": ["--disable-sync"]}
    )
    assert result["unlisted"] == []


def test_ties_engine_switches_and_known_leaks_to_catalogue_entries() -> None:
    result = classify_differences(
        [
            EXTRA_SWITCH,
            {
                "path": "navigator.userAgentData.brands.0.brand",
                "reference": "Not)A;Brand",
                "candidate": "Not.A/Brand",
            },
            {"path": "navigator.webdriver", "reference": False, "candidate": True},
        ],
        {"launch": "engine", "attached": True, "requested_args": []},
    )
    assert [entry["limitation"] for entry in result["differences"]] == [
        "engine-launch-switches",
        "grease-brand-not-reproduced",
        "automation-controlled-is-launch-only",
    ]
    assert result["unlisted"] == []


def test_ties_field_trial_surfaces_to_the_engine_switches_that_move_them() -> None:
    surfaces = [
        {
            "path": "navigator.keys",
            "reference": ["clipboard"],
            "candidate": ["clipboard", "runAdAuction"],
        },
        {
            "path": "worker.navigator.languages",
            "reference": ["en-US"],
            "candidate": ["en-US", "en"],
        },
    ]
    engine = classify_differences(
        surfaces,
        {
            "launch": "engine",
            "extra_switches": ["--disable-field-trial-config"],
            "requested_args": [],
        },
    )
    assert engine["unlisted"] == []
    assert [entry["limitation"] for entry in engine["differences"]] == [
        "engine-launch-switches",
        "engine-launch-switches",
    ]

    # A feature switch with a value counts too, and the JS key is accepted.
    with_value = classify_differences(
        surfaces,
        {
            "launch": "engine",
            "extraSwitches": ["--disable-features=Translate"],
            "requestedArgs": [],
        },
    )
    assert with_value["unlisted"] == []

    # The same surfaces stay unexplained for the real launch, and for an
    # engine launch that did not touch the feature configuration.
    for context in (
        {"launch": "real", "extra_switches": ["--disable-field-trial-config"]},
        {"launch": "engine", "extra_switches": ["--disable-sync"]},
    ):
        result = classify_differences(surfaces, {**context, "requested_args": []})
        assert len(result["unlisted"]) == 2


def test_does_not_excuse_navigator_webdriver_for_a_launched_browser() -> None:
    result = classify_differences(
        [{"path": "navigator.webdriver", "reference": False, "candidate": True}],
        {"launch": "real", "attached": False, "requested_args": []},
    )
    assert len(result["unlisted"]) == 1


# ---------------------------------------------------------------------------
# Diffing probe reports
# ---------------------------------------------------------------------------


def test_diff_reports_walks_nested_values_and_ignores_volatile_paths() -> None:
    differences = diff_reports(
        {"a": 1, "b": {"c": [1, 2]}, "same": 2.0},
        {"a": 1, "b": {"c": [1, 3]}, "same": 2, "d": True},
    )
    assert differences == [
        {"path": "b.c", "reference": [1, 2], "candidate": [1, 3]},
        {"path": "d", "reference": None, "candidate": True},
    ]
    assert diff_reports({"a": 1}, {"a": 2}, ignore=["a"]) == []


# ---------------------------------------------------------------------------
# measure_parity
# ---------------------------------------------------------------------------


def _fakes(
    candidate_command_line: str, candidate_report: Any = None
) -> tuple[list[Any], dict[str, Any], dict[str, Any]]:
    calls: list[Any] = []

    class Page:
        async def goto(self, url: str, **_options: Any) -> None:
            calls.append(("goto", url))

    class Browser:
        async def close(self) -> None:
            calls.append(("close",))

    session: dict[str, Any] = {
        "launch": "real",
        "args": [],
        "page": Page(),
        "browser": Browser(),
    }
    reports = [{"a": 1}, {"a": 1} if candidate_report is None else candidate_report]

    class Server:
        def url(self, token: str) -> str:
            return f"http://127.0.0.1:1/probe/{token}"

        async def wait_for_report(self, _token: str) -> Any:
            return reports.pop()

        async def close(self) -> None:
            calls.append(("server-close",))

    async def launch_browser(options: Any) -> Any:
        calls.append(("launch", options))
        return session

    async def resolve_launch_executable(**_options: Any) -> str:
        return CHROME

    async def read_probe() -> str:
        return "async () => ({})"

    async def start_server(_source: str) -> Server:
        return Server()

    async def capture_reference(**_options: Any) -> Any:
        return reports.pop()

    async def read_reference_version(**options: Any) -> dict[str, str]:
        headless = (
            " --headless=new --ozone-platform=headless" if options["headless"] else ""
        )
        return {
            "commandLine": f"{CHROME} --user-data-dir=/tmp/r "
            f"--remote-debugging-port=1{headless} about:blank"
        }

    async def read_version_page(_page: Any) -> dict[str, str]:
        return {
            "commandLine": candidate_command_line,
            "version": "153.0.8010.36\n (Official Build)\n (64-bit)",
            "executablePath": CHROME,
        }

    dependencies = {
        "resolve_launch_executable": resolve_launch_executable,
        "launch_browser": launch_browser,
        "read_probe": read_probe,
        "start_server": start_server,
        "capture_reference": capture_reference,
        "read_reference_version": read_reference_version,
        "read_version_page": read_version_page,
    }
    return calls, session, dependencies


async def test_is_ok_when_the_launched_browser_matches_the_hand_started_one() -> None:
    calls, _session, dependencies = _fakes(
        f"{CHROME} --user-data-dir=/tmp/c --remote-debugging-port=2 "
        "--headless=new --ozone-platform=headless about:blank"
    )
    report = await measure_parity({"headless": True}, dependencies)
    assert report["ok"] is True
    assert report["unlisted"] == []
    assert report["commandLine"]["extra"] == []
    assert report["commandLine"]["attachment"] == ["--remote-debugging-port=2"]
    assert report["browser"]["version"] == "153.0.8010.36 (Official Build) (64-bit)"
    assert report["browser"]["launch"] == "real"
    assert [call[0] for call in calls] == ["launch", "goto", "close", "server-close"]
    # The report uses the JavaScript key names.
    assert list(report) == ["browser", "commandLine", "differences", "unlisted", "ok"]
    assert list(report["browser"]) == [
        "executablePath",
        "version",
        "engine",
        "launch",
        "headless",
    ]
    assert list(report["commandLine"]) == [
        "launched",
        "reference",
        "extra",
        "missing",
        "changed",
        "attachment",
        "features",
    ]


async def test_fails_on_an_unlisted_switch_or_probe_difference() -> None:
    _calls, _session, dependencies = _fakes(
        f"{CHROME} --user-data-dir=/tmp/c --remote-debugging-port=2 "
        "--disable-sync about:blank",
        candidate_report={"a": 2},
    )
    report = await measure_parity({}, dependencies)
    assert report["ok"] is False
    assert [entry["path"] for entry in report["unlisted"]] == [
        "commandLine.extra.--disable-sync",
        "a",
    ]


async def test_measures_a_provided_session_and_leaves_it_open() -> None:
    calls, session, dependencies = _fakes(
        f"{CHROME} --user-data-dir=/tmp/c --remote-debugging-port=2 about:blank"
    )
    report = await measure_parity(
        {"session": {**session, "executable_path": CHROME}}, dependencies
    )
    assert report["ok"] is True
    assert [call[0] for call in calls] == ["goto", "server-close"]
