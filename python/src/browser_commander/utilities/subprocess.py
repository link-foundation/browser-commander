"""Run and supervise child processes without a shell (issue #104).

Every subprocess Browser Commander starts - installed browsers and the
credential tools used for cookie import (``security``, ``secret-tool``,
``kwallet-query``, ``icacls``, ``whoami``) - goes through this module.

The JavaScript package routes the same calls through `command-stream`_ and the
Rust crate through its ``command-stream`` crate. command-stream has no Python
port, so this module mirrors its small interface on top of :mod:`asyncio` and
:mod:`subprocess`:

* :func:`run_command` runs a file to completion and returns
  ``CommandResult(stdout, stderr, code)``, raising :class:`CommandError` on a
  non-zero exit unless ``check=False``;
* :func:`start_process` starts a long-running process and returns a
  :class:`ManagedProcess` with ``pid``, ``exit_code``, ``stdout``/``stderr``
  ``data`` listeners, an ``exit`` listener, an awaitable :meth:`~ManagedProcess.wait`
  and a :meth:`~ManagedProcess.kill` that escalates from SIGTERM to SIGKILL.

The file is executed directly with exact argv boundaries; no shell is ever in
between, so arguments are never re-split or expanded.

.. _command-stream: https://github.com/link-foundation/command-stream
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import subprocess
import sys
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Union

__all__ = [
    "CommandError",
    "CommandResult",
    "ManagedProcess",
    "OutputChannel",
    "run_command",
    "run_command_sync",
    "start_process",
]

_READ_CHUNK_SIZE = 65_536

CommandInput = Union[str, bytes, None]


@dataclass(frozen=True)
class CommandResult:
    """Output and exit status of a finished command."""

    stdout: str
    stderr: str
    code: int


class CommandError(subprocess.CalledProcessError):
    """A command exited with a non-zero status.

    It subclasses :class:`subprocess.CalledProcessError`, so code that already
    catches that keeps working. The argument list is available as
    ``arguments`` (``args`` is taken by :class:`BaseException`) and the full
    argv as ``cmd``.
    """

    def __init__(self, file: str, arguments: Sequence[str], result: CommandResult):
        super().__init__(
            result.code,
            [file, *arguments],
            output=result.stdout,
            stderr=result.stderr,
        )
        self.file = file
        self.arguments = list(arguments)
        self.code = result.code
        self.exit_code = result.code

    def __str__(self) -> str:
        stderr = str(self.stderr or "").strip()
        suffix = f": {stderr}" if stderr else ""
        return f"{self.file} exited with code {self.code}{suffix}"


def _decode(data: bytes | str | None) -> str:
    if data is None:
        return ""
    if isinstance(data, str):
        return data
    return data.decode("utf-8", errors="replace")


def _encode(data: CommandInput) -> bytes | None:
    if data is None:
        return None
    return data.encode("utf-8") if isinstance(data, str) else data


def _environment(env: Mapping[str, str] | None) -> dict[str, str] | None:
    return None if env is None else {str(k): str(v) for k, v in env.items()}


async def run_command(
    file: str,
    args: Sequence[str] = (),
    *,
    env: Mapping[str, str] | None = None,
    cwd: str | os.PathLike[str] | None = None,
    input: CommandInput = None,
    check: bool = True,
) -> CommandResult:
    """Run ``file`` with exactly ``args`` and return its output.

    Args:
        file: Executable to run, resolved through ``PATH``.
        args: Exact arguments; no shell parsing happens.
        env: Complete environment for the child only. ``None`` inherits ours.
        cwd: Working directory for the child.
        input: Data written to the child's stdin; stdin is closed otherwise.
        check: Raise :class:`CommandError` on a non-zero exit.

    Raises:
        OSError: When the executable cannot be started (for example
            :class:`FileNotFoundError`).
        CommandError: When ``check`` is true and the exit code is not zero.
    """

    arguments = [str(argument) for argument in args]
    process = await asyncio.create_subprocess_exec(
        file,
        *arguments,
        stdin=asyncio.subprocess.DEVNULL if input is None else asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_environment(env),
        cwd=None if cwd is None else os.fspath(cwd),
    )
    stdout, stderr = await process.communicate(_encode(input))
    result = CommandResult(
        stdout=_decode(stdout),
        stderr=_decode(stderr),
        code=process.returncode if process.returncode is not None else 1,
    )
    if check and result.code != 0:
        raise CommandError(file, arguments, result)
    return result


def run_command_sync(
    file: str,
    args: Sequence[str] = (),
    *,
    env: Mapping[str, str] | None = None,
    cwd: str | os.PathLike[str] | None = None,
    input: CommandInput = None,
    check: bool = True,
) -> CommandResult:
    """Blocking twin of :func:`run_command` for synchronous call sites.

    Cookie import runs outside an event loop, so its credential-store and
    ACL helpers use this; the semantics are the same as :func:`run_command`.
    """

    arguments = [str(argument) for argument in args]
    completed = subprocess.run(
        [file, *arguments],
        input=_encode(input),
        stdin=subprocess.DEVNULL if input is None else None,
        capture_output=True,
        env=_environment(env),
        cwd=None if cwd is None else os.fspath(cwd),
        check=False,
        shell=False,
    )
    result = CommandResult(
        stdout=_decode(completed.stdout),
        stderr=_decode(completed.stderr),
        code=completed.returncode,
    )
    if check and result.code != 0:
        raise CommandError(file, arguments, result)
    return result


DataListener = Callable[[str], Any]
ExitListener = Callable[[int], Any]


class OutputChannel:
    """Fan a child's output stream out to ``data`` listeners.

    Mirrors the part of a Node.js readable stream the launchers use:
    ``channel.on("data", listener)`` and ``channel.off("data", listener)``.
    Chunks are delivered as text. Like a paused Node.js stream, output that
    arrives before the first listener is kept (up to 64 KiB) and handed to that
    listener, so a caller that subscribes right after starting the process
    cannot miss the first lines.
    """

    def __init__(self) -> None:
        self._listeners: list[DataListener] = []
        self._pending: str | None = ""

    def on(self, event: str, listener: DataListener) -> OutputChannel:
        if event == "data" and listener not in self._listeners:
            self._listeners.append(listener)
            pending, self._pending = self._pending, None
            if pending:
                listener(pending)
        return self

    def off(self, event: str, listener: DataListener) -> OutputChannel:
        if event == "data" and listener in self._listeners:
            self._listeners.remove(listener)
        return self

    def emit(self, chunk: str) -> None:
        if self._pending is not None:
            self._pending = f"{self._pending}{chunk}"[-_READ_CHUNK_SIZE:]
            return
        for listener in list(self._listeners):
            listener(chunk)


class ManagedProcess:
    """Handle for a process started by :func:`start_process`.

    ``exit_code`` (also ``returncode``) is ``None`` while the process runs.
    Output is always drained, so a chatty child can never block on a full pipe.
    """

    def __init__(
        self,
        process: asyncio.subprocess.Process,
        *,
        forward_output: bool = False,
        kill_grace: float = 2.0,
    ) -> None:
        self._process = process
        self._forward_output = forward_output
        self._kill_grace = kill_grace
        self._exit_code: int | None = None
        self._exit_listeners: list[ExitListener] = []
        self._escalation: asyncio.TimerHandle | None = None
        self.stdout = OutputChannel()
        self.stderr = OutputChannel()
        loop = asyncio.get_running_loop()
        self._readers = [
            loop.create_task(
                self._pump(process.stdout, self.stdout, sys.stdout),
            ),
            loop.create_task(
                self._pump(process.stderr, self.stderr, sys.stderr),
            ),
        ]
        self._exited: asyncio.Task[int] = loop.create_task(self._supervise())

    async def _pump(
        self,
        stream: asyncio.StreamReader | None,
        channel: OutputChannel,
        mirror: Any,
    ) -> None:
        if stream is None:
            return
        while True:
            try:
                data = await stream.read(_READ_CHUNK_SIZE)
            except (OSError, ValueError):
                return
            if not data:
                return
            chunk = _decode(data)
            if self._forward_output:
                with contextlib.suppress(Exception):
                    mirror.write(chunk)
                    mirror.flush()
            with contextlib.suppress(Exception):
                channel.emit(chunk)

    async def _supervise(self) -> int:
        code = await self._process.wait()
        # Let the readers deliver what the child wrote before it exited.
        with contextlib.suppress(Exception):
            await asyncio.wait_for(asyncio.gather(*self._readers), timeout=1)
        self._exit_code = code if isinstance(code, int) else 1
        if self._escalation is not None:
            self._escalation.cancel()
            self._escalation = None
        for listener in list(self._exit_listeners):
            with contextlib.suppress(Exception):
                listener(self._exit_code)
        self._exit_listeners.clear()
        return self._exit_code

    @property
    def pid(self) -> int:
        """Operating-system process id."""
        return self._process.pid

    @property
    def exit_code(self) -> int | None:
        """Exit code once the process has exited, otherwise ``None``.

        A process killed by a signal reports the negative signal number, as
        :attr:`subprocess.Popen.returncode` does.
        """
        return self._exit_code

    @property
    def returncode(self) -> int | None:
        """Alias of :attr:`exit_code`, matching :mod:`subprocess` naming."""
        return self._exit_code

    @property
    def exited(self) -> Awaitable[int]:
        """Awaitable that resolves to the exit code."""
        return asyncio.shield(self._exited)

    async def wait(self) -> int:
        """Wait for the process to exit and return its exit code."""
        return await asyncio.shield(self._exited)

    def on(self, event: str, listener: ExitListener) -> ManagedProcess:
        """Register an ``exit`` listener; it runs at once if already exited."""
        if event == "exit":
            if self._exit_code is not None:
                listener(self._exit_code)
            else:
                self._exit_listeners.append(listener)
        return self

    def once(self, event: str, listener: ExitListener) -> ManagedProcess:
        """Same as :meth:`on`: ``exit`` fires only once."""
        return self.on(event, listener)

    def kill(self, sig: int | None = None) -> bool:
        """Stop the process: ``sig`` (SIGTERM) first, SIGKILL after the grace.

        Returns:
            Whether a running process was signalled.
        """
        if self._exit_code is not None or self._process.returncode is not None:
            return False
        try:
            if sig is None:
                self._process.terminate()
            else:
                self._process.send_signal(sig)
        except ProcessLookupError:
            return False
        if self._escalation is None and self._kill_grace is not None:
            loop = asyncio.get_running_loop()
            self._escalation = loop.call_later(
                max(0.0, self._kill_grace), self._force_kill
            )
        return True

    def terminate(self) -> bool:
        """Alias of :meth:`kill` with the default signal."""
        return self.kill()

    def _force_kill(self) -> None:
        self._escalation = None
        if self._exit_code is None and self._process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                self._process.kill()


async def start_process(
    file: str,
    args: Sequence[str] = (),
    *,
    env: Mapping[str, str] | None = None,
    cwd: str | os.PathLike[str] | None = None,
    forward_output: bool = False,
    kill_grace: float = 2.0,
) -> ManagedProcess:
    """Start a long-running process, such as a browser.

    Args:
        file: Executable path.
        args: Exact arguments; no shell parsing happens.
        env: Complete environment for the child only. ``None`` inherits ours.
        cwd: Working directory for the child.
        forward_output: Mirror the child's stdout/stderr to this process.
        kill_grace: Seconds between SIGTERM and SIGKILL in
            :meth:`ManagedProcess.kill`.
    """

    process = await asyncio.create_subprocess_exec(
        file,
        *[str(argument) for argument in args],
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_environment(env),
        cwd=None if cwd is None else os.fspath(cwd),
    )
    return ManagedProcess(process, forward_output=forward_output, kill_grace=kill_grace)
