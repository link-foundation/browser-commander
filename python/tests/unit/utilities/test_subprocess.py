"""The command-stream style subprocess wrapper (issue #104)."""

from __future__ import annotations

import subprocess
import sys

import pytest

from browser_commander.utilities.subprocess import (
    CommandError,
    OutputChannel,
    run_command,
    run_command_sync,
    start_process,
)

PYTHON = sys.executable


async def test_run_command_captures_output_without_a_shell() -> None:
    result = await run_command(
        PYTHON, ["-c", "import sys; print(sys.argv[1])", "a b; echo injected"]
    )
    assert result.code == 0
    assert result.stdout.strip() == "a b; echo injected"
    assert result.stderr == ""


async def test_run_command_raises_command_error_on_failure() -> None:
    with pytest.raises(CommandError) as caught:
        await run_command(
            PYTHON, ["-c", "import sys; sys.stderr.write('boom'); sys.exit(3)"]
        )
    error = caught.value
    assert isinstance(error, subprocess.CalledProcessError)
    assert error.code == 3
    assert error.exit_code == 3
    assert error.stderr == "boom"
    assert "exited with code 3: boom" in str(error)

    result = await run_command(PYTHON, ["-c", "raise SystemExit(4)"], check=False)
    assert result.code == 4


async def test_run_command_passes_env_and_input() -> None:
    result = await run_command(
        PYTHON,
        ["-c", "import os, sys; print(os.environ['ONLY_CHILD'], sys.stdin.read())"],
        env={"ONLY_CHILD": "yes"},
        input="piped",
    )
    assert result.stdout.strip() == "yes piped"


def test_run_command_sync() -> None:
    assert run_command_sync(PYTHON, ["-c", "print(42)"]).stdout.strip() == "42"
    with pytest.raises(CommandError):
        run_command_sync(PYTHON, ["-c", "raise SystemExit(2)"])


async def test_start_process_streams_output_and_reports_exit() -> None:
    process = await start_process(
        PYTHON,
        # Bytes, so Windows text mode does not turn the newline into CRLF.
        ["-c", "import sys; sys.stderr.buffer.write(b'ready\\n'); sys.stderr.flush()"],
    )
    chunks: list[str] = []
    process.stderr.on("data", chunks.append)
    exits: list[int] = []
    process.once("exit", exits.append)

    assert await process.wait() == 0
    assert process.exit_code == 0
    assert process.returncode == 0
    assert "".join(chunks) == "ready\n"
    assert exits == [0]
    # A listener added after exit runs at once.
    process.once("exit", exits.append)
    assert exits == [0, 0]
    assert process.kill() is False


async def test_kill_terminates_a_running_process() -> None:
    process = await start_process(
        PYTHON, ["-c", "import time; time.sleep(60)"], kill_grace=0.5
    )
    assert process.exit_code is None
    assert process.kill() is True
    code = await process.wait()
    assert code != 0
    assert process.exit_code == code


def test_output_channel_keeps_output_until_the_first_listener() -> None:
    channel = OutputChannel()
    channel.emit("early ")
    received: list[str] = []
    channel.on("data", received.append)
    channel.emit("late")
    assert received == ["early ", "late"]
    channel.off("data", received.append)
    channel.emit("ignored")
    assert received == ["early ", "late"]
