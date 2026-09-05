#!/usr/bin/env python3
"""Read and rewrite a single field of pyproject.toml, table-aware and fail-loud.

The release workflow used to scrape the version with::

    CURRENT_VERSION=$(grep -Po '(?<=^version = ")[^"]*' pyproject.toml)

That pattern is anchored to the start of a line but not to a TOML table, and
``pyproject.toml`` declares ``version`` twice::

    [project]      version = "0.5.3"
    [tool.scriv]   version = "literal: pyproject.toml: project.version"

The step therefore appended two lines to ``$GITHUB_OUTPUT`` and GitHub refused
them with ``Unable to process file command 'output' successfully`` /
``Invalid format 'literal: pyproject.toml: project.version'``, which is why
every Python release failed after the scriv key was introduced.

The same blind spot exists on the write side: a ``re.sub`` over the whole file
rewrites the scriv literal as if it were a version number, silently destroying
the changelog configuration on the next bump.

This module keeps both operations scoped to the table that owns the key. It
implements only the TOML subset the manifests use (single-line scalar values in
named tables) so it also runs on Python 3.9, where ``tomllib`` does not exist.

Usage:
    python scripts/read_manifest.py pyproject.toml
    python scripts/read_manifest.py pyproject.toml --field name --output pkg
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

# TOML table that owns the package metadata, per manifest file name.
DEFAULT_TABLES = {"pyproject.toml": "project", "Cargo.toml": "package"}

_TABLE_HEADER = re.compile(r"^\[\[?([^\]]+)\]\]?$")


def strip_comment(line: str) -> str:
    """Remove an unquoted ``#`` comment; a ``#`` inside quotes stays."""
    quote: str | None = None
    for index, character in enumerate(line):
        if quote:
            if character == quote:
                quote = None
        elif character in "\"'":
            quote = character
        elif character == "#":
            return line[:index].strip()
    return line.strip()


def find_field_line(content: str, table: str, field: str) -> int | None:
    """Return the 0-based index of the line assigning ``field`` inside ``table``."""
    assignment = re.compile(rf"^{re.escape(field)}\s*=\s*(.*)$")
    current_table = ""

    for index, raw_line in enumerate(content.split("\n")):
        line = strip_comment(raw_line)
        if not line:
            continue

        header = _TABLE_HEADER.match(line)
        if header:
            current_table = header.group(1).strip()
            continue

        if current_table == table and assignment.match(line):
            return index

    return None


def read_field(content: str, table: str, field: str) -> str | None:
    """Return the value of ``field`` inside ``table``, or ``None`` when absent."""
    index = find_field_line(content, table, field)
    if index is None:
        return None

    value = strip_comment(content.split("\n")[index]).split("=", 1)[1].strip()
    quoted = re.match(r"^(['\"])(.*)\1$", value)
    return quoted.group(2) if quoted else value


def replace_field(content: str, table: str, field: str, new_value: str) -> str:
    """Rewrite ``field`` inside ``table`` only, leaving other tables untouched."""
    index = find_field_line(content, table, field)
    if index is None:
        raise ValueError(f"No [{table}] {field} to update")

    lines = content.split("\n")
    lines[index] = re.sub(
        r"^(\s*" + re.escape(field) + r"\s*=\s*[\"'])[^\"']*([\"'])",
        rf"\g<1>{new_value}\g<2>",
        lines[index],
    )
    return "\n".join(lines)


def read_manifest_field(
    manifest_path: Path, field: str = "version", table: str | None = None
) -> str:
    """Read one metadata field, refusing empty or multi-line values.

    An empty version would tag and publish the wrong release, so this raises
    instead of returning it.
    """
    resolved_table = table or DEFAULT_TABLES.get(manifest_path.name, "project")
    value = read_field(manifest_path.read_text(), resolved_table, field)

    if not value:
        raise ValueError(
            f'{manifest_path} has no non-empty "{field}" in [{resolved_table}]. '
            "Refusing to continue: an empty version would tag and publish the "
            "wrong release."
        )

    if "\n" in value or "\r" in value:
        raise ValueError(
            f'{manifest_path} produced a multi-line "{field}": {value!r}. '
            "GitHub Actions rejects multi-line values written with `key=value`."
        )

    return value


def set_github_output(key: str, value: str) -> None:
    """Append ``key=value`` to the GitHub Actions output file, when running in CI."""
    output_file = os.environ.get("GITHUB_OUTPUT")
    if output_file:
        with Path(output_file).open("a") as handle:
            handle.write(f"{key}={value}\n")


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", help="path to pyproject.toml or Cargo.toml")
    parser.add_argument("--field", default="version", help="key to read")
    parser.add_argument("--table", default=None, help="TOML table owning the key")
    parser.add_argument(
        "--output", default=None, help="name to write to $GITHUB_OUTPUT"
    )
    args = parser.parse_args(argv)

    try:
        value = read_manifest_field(Path(args.manifest), args.field, args.table)
    except (OSError, ValueError) as error:
        print(f"::error::{error}", file=sys.stderr)
        return 1

    if args.output:
        set_github_output(args.output, value)

    print(value)
    return 0


if __name__ == "__main__":
    sys.exit(main())
