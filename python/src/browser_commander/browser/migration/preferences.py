"""Migrate a safe subset of Chromium ``Preferences``.

Only user-facing settings that carry no per-profile MAC and no machine
binding are copied: languages, spellcheck, the default search provider,
theme, home page and startup pages. Everything else in the target
``Preferences`` is preserved.
"""

from __future__ import annotations

import json
from collections.abc import MutableMapping, Sequence
from pathlib import Path
from typing import Any

from browser_commander.browser.migration.fs_utils import PathLike, write_compact_json

__all__ = [
    "MIGRATED_PREFERENCE_PATHS",
    "merge_preference_subset",
    "migrate_preferences",
]

#: Dotted ``Preferences`` paths copied from the source profile.
MIGRATED_PREFERENCE_PATHS = (
    "intl.accept_languages",
    "intl.selected_languages",
    "spellcheck.dictionaries",
    "default_search_provider_data",
    "browser.theme",
    "extensions.theme",
    "homepage",
    "homepage_is_newtabpage",
    "session.startup_urls",
    "session.restore_on_startup",
    "bookmark_bar.show_on_all_tabs",
)

_MISSING = object()


def _get_path(document: Any, dotted_path: str) -> Any:
    node = document
    for key in dotted_path.split("."):
        if not isinstance(node, dict) or key not in node:
            return _MISSING
        node = node[key]
    return node


def _set_path(document: MutableMapping[str, Any], dotted_path: str, value: Any) -> None:
    keys = dotted_path.split(".")
    node: MutableMapping[str, Any] = document
    for key in keys[:-1]:
        if not isinstance(node.get(key), dict):
            node[key] = {}
        node = node[key]
    node[keys[-1]] = value


def merge_preference_subset(
    source: Any,
    target: MutableMapping[str, Any],
    paths: Sequence[str] = MIGRATED_PREFERENCE_PATHS,
) -> tuple[MutableMapping[str, Any], list[str]]:
    """Copy each present ``paths`` entry from ``source`` into ``target``.

    Returns:
        ``(target, migrated_paths)``; ``target`` is modified in place.
    """

    migrated_paths: list[str] = []
    for dotted_path in paths:
        value = _get_path(source, dotted_path)
        if value is not _MISSING:
            _set_path(target, dotted_path, value)
            migrated_paths.append(dotted_path)
    return target, migrated_paths


def migrate_preferences(
    *, source_profile_dir: PathLike, target_profile_dir: PathLike
) -> dict[str, Any]:
    """Merge the migratable preference subset into the target ``Preferences``."""

    source_path = Path(source_profile_dir) / "Preferences"
    if not source_path.exists():
        return {
            "migrated": 0,
            "skipped": [
                {
                    "type": "preferences",
                    "item": "Preferences",
                    "reason": "source-missing",
                }
            ],
            "warnings": [],
        }
    source = json.loads(source_path.read_text(encoding="utf-8"))
    target_dir = Path(target_profile_dir)
    target_path = target_dir / "Preferences"
    target: Any = {}
    if target_path.exists():
        try:
            target = json.loads(target_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            target = {}
    if not isinstance(target, dict):
        target = {}
    merged, migrated_paths = merge_preference_subset(source, target)
    target_dir.mkdir(parents=True, exist_ok=True)
    write_compact_json(target_path, merged)
    return {"migrated": len(migrated_paths), "skipped": [], "warnings": []}
