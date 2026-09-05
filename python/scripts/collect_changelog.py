#!/usr/bin/env python3
"""
Collect changelog fragments into CHANGELOG.md for a release.

Thin wrapper around `scriv collect` that exists to pin down the one thing the
workflow kept getting wrong: `scriv collect --version` takes the *version name*
that heads the new section, not a bump type. The pipeline used to call

    scriv collect --version "$BUMP_TYPE"

which wrote a section literally titled `patch` into CHANGELOG.md.

Usage:
    python scripts/collect_changelog.py --version 1.2.3

Exits 0 and does nothing when there are no fragments to collect.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

FRAGMENT_DIR = "changelog.d"


def list_fragment_files(cwd: Path | str = ".") -> list[Path]:
    """Return the fragment files `scriv collect` would consume.

    Non-recursive on purpose: `changelog.d/templates/` holds the Jinja
    templates, which are not fragments.
    """
    directory = Path(cwd) / FRAGMENT_DIR
    if not directory.is_dir():
        return []
    return sorted(
        path
        for path in directory.iterdir()
        if path.is_file() and path.suffix == ".md" and path.name != "README.md"
    )


def collect(version: str, cwd: Path | str = ".") -> bool:
    """Collect fragments into CHANGELOG.md under the `version` heading.

    Returns True when `scriv collect` ran, False when there was nothing to do.
    """
    fragments = list_fragment_files(cwd)
    if not fragments:
        print("No changelog fragments found, skipping collection")
        return False

    if shutil.which("scriv") is None:
        raise RuntimeError(
            "::error::scriv is not installed, so "
            f"{len(fragments)} changelog fragment(s) cannot be collected. "
            'Install it with: pip install "scriv[toml]"'
        )

    names = ", ".join(path.name for path in fragments)
    print(f"Found {len(fragments)} changelog fragment(s): {names}")
    print(f"Collecting into CHANGELOG.md under version {version}")
    subprocess.run(
        ["scriv", "collect", "--version", version],
        cwd=str(cwd),
        check=True,
    )
    return True


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Collect changelog fragments into CHANGELOG.md",
    )
    parser.add_argument(
        "--version",
        "-v",
        required=True,
        help="Version being released (e.g. 1.2.3), used as the section heading",
    )
    parser.add_argument(
        "--directory",
        "-C",
        default=None,
        help="Project directory (default: the python package root)",
    )

    args = parser.parse_args()
    cwd = (
        Path(args.directory)
        if args.directory
        else Path(__file__).resolve().parent.parent
    )

    try:
        collect(args.version, cwd)
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
