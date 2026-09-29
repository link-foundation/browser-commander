"""Python entry point for the shared Browser Commander command protocol.

The JavaScript CLI owns the generic handle dispatcher used for Playwright and
Puppeteer. Forwarding its JSON protocol gives Python access to those engines
without a second, divergent implementation of their public APIs. The child is
started through the package's subprocess interface, which also handles the
native Python launcher's browser and credential-tool processes.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from collections.abc import Sequence
from importlib.metadata import version
from pathlib import Path

from browser_commander.utilities.subprocess import run_command, start_process


def js_cli_path() -> Path:
    """Find the companion npm CLI in a checkout or at an explicit path."""
    configured = os.environ.get("BROWSER_COMMANDER_JS_CLI")
    candidates = (
        [Path(configured)]
        if configured
        else [
            Path(__file__).resolve().parents[3] / "js/bin/browser-commander.js",
            Path.cwd() / "node_modules/browser-commander/bin/browser-commander.js",
        ]
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(
        "The JavaScript CLI is required for cross-engine commands; install the "
        "browser-commander npm package or set BROWSER_COMMANDER_JS_CLI"
    )


async def run_cli(args: Sequence[str]) -> int:
    """Run one command with the JSON output and exit codes of the shared CLI."""
    if args and args[0] == "version":
        print(
            json.dumps(
                {
                    "name": "browser-commander",
                    "version": version("browser-commander"),
                    "language": "python",
                },
                separators=(",", ":"),
            )
        )
        return 0

    try:
        cli = js_cli_path()
        command = [str(cli), *args]
        node = os.environ.get("BROWSER_COMMANDER_NODE", "node")
        streaming = (args[:2] == ["serve", "--stdio"]) or (
            args and args[0] == "launch" and "--keep-open" in args
        )
        if streaming:
            process = await start_process(
                node, command, forward_output=True, stdin_mode="inherit"
            )
            return await process.wait()
        result = await run_command(node, command, check=False)
        sys.stdout.write(result.stdout)
        sys.stderr.write(result.stderr)
        return result.code
    except (OSError, ValueError) as error:
        print(
            json.dumps({"error": {"name": type(error).__name__, "message": str(error)}})
        )
        return 1


def main() -> None:
    """Console-script hook."""
    raise SystemExit(asyncio.run(run_cli(sys.argv[1:])))


if __name__ == "__main__":  # pragma: no cover
    main()
