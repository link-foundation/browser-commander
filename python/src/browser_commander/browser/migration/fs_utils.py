"""Small filesystem helpers shared by the profile migration modules."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Union

__all__ = [
    "PathLike",
    "path_exists",
    "profile_file_if_present",
    "read_json_if_present",
    "write_compact_json",
]

PathLike = Union[str, "os.PathLike[str]"]


def path_exists(file_path: PathLike) -> bool:
    """Return whether ``file_path`` exists (following symlinks)."""

    return Path(file_path).exists()


def read_json_if_present(file_path: PathLike) -> Any | None:
    """Parse a JSON file, or return ``None`` when it is missing or invalid."""

    path = Path(file_path)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def profile_file_if_present(profile_dir: PathLike, name: str) -> Path | None:
    """Return ``profile_dir / name`` when that file exists, otherwise ``None``."""

    path = Path(profile_dir) / name
    return path if path.exists() else None


def write_compact_json(file_path: PathLike, value: Any) -> None:
    """Write ``value`` exactly as JavaScript's ``JSON.stringify`` would."""

    Path(file_path).write_text(
        json.dumps(value, separators=(",", ":"), ensure_ascii=False),
        encoding="utf-8",
    )
