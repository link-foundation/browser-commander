"""Contract checks for the Python command entry point."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from browser_commander import cli
from browser_commander.utilities.subprocess import CommandResult


# feature-parity: cli.version
async def test_version_reports_the_python_package(capsys: Any) -> None:
    assert await cli.run_cli(["version"]) == 0
    assert '"language":"python"' in capsys.readouterr().out


# feature-parity: cli.script
async def test_script_forwards_exact_arguments(monkeypatch: Any, capsys: Any) -> None:
    calls: list[Any] = []

    async def run(node: str, args: list[str], **options: Any) -> CommandResult:
        calls.append((node, args, options))
        return CommandResult('{"results":[]}', "", 0)

    monkeypatch.setattr(cli, "js_cli_path", lambda: Path("/tmp/cli.js"))
    monkeypatch.setattr(cli, "run_command", run)
    assert await cli.run_cli(["run", "script.json", "--engine", "playwright"]) == 0
    assert calls == [
        (
            "node",
            ["/tmp/cli.js", "run", "script.json", "--engine", "playwright"],
            {"check": False},
        )
    ]
    assert capsys.readouterr().out == '{"results":[]}'


# feature-parity: cli.serve
async def test_stdio_bridge_inherits_input(monkeypatch: Any) -> None:
    calls: list[Any] = []

    class Process:
        async def wait(self) -> int:
            return 0

    async def start(node: str, args: list[str], **options: Any) -> Process:
        calls.append((node, args, options))
        return Process()

    monkeypatch.setattr(cli, "js_cli_path", lambda: Path("/tmp/cli.js"))
    monkeypatch.setattr(cli, "start_process", start)
    assert await cli.run_cli(["serve", "--stdio"]) == 0
    assert calls == [
        (
            "node",
            ["/tmp/cli.js", "serve", "--stdio"],
            {"forward_output": True, "stdin_mode": "inherit"},
        )
    ]
