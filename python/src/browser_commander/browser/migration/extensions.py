"""Migrate Chromium extensions: their files and their settings entries.

An extension lives in ``Extensions/<id>/<version>/`` and in
``extensions.settings.<id>`` of ``Secure Preferences``. Both are copied.

``Secure Preferences`` is protected by a per-entry HMAC seeded with a key
embedded in the browser binary and a per-profile/machine identifier, so a MAC
copied from the source profile does not validate for the target. Chrome then
treats the entry as tampered and usually disables the extension. The MAC cannot
be forged without the embedded key, so every migration with extensions reports
the ``mac-will-not-validate`` warning.

Policy-installed and component extensions (by ``Manifest::Location``) and
default extensions without a manifest are never copied.
"""

from __future__ import annotations

import shutil
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from browser_commander.browser.migration.fs_utils import (
    PathLike,
    read_json_if_present,
    write_compact_json,
)

__all__ = ["migrate_extensions", "select_migratable_extensions"]

# Chrome's Manifest::Location values excluded from a migration:
# COMPONENT, EXTERNAL_POLICY_DOWNLOAD, EXTERNAL_POLICY, EXTERNAL_COMPONENT.
_EXCLUDED_LOCATIONS = frozenset({5, 7, 9, 10})

_SECURE_PREFERENCES = "Secure Preferences"

_MAC_WARNING_DETAIL = (
    "Extension files and settings were copied, but Chrome computes a "
    "per-profile HMAC over Secure Preferences that cannot be reproduced for "
    "the target profile. Chrome will likely disable the migrated extensions "
    "on first launch; re-enable them or reinstall from the Web Store to "
    "restore a valid MAC."
)


def _location(entry: Any) -> float | None:
    value = entry.get("location") if isinstance(entry, Mapping) else None
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip() or "0")
        except ValueError:
            return None
    return None


def select_migratable_extensions(
    settings: Mapping[str, Any] | None,
) -> dict[str, list[Any]]:
    """Split an ``extensions.settings`` map into eligible and excluded ids.

    Returns:
        ``{"eligible": [id, ...], "excluded": [{"id": id, "reason": r}, ...]}``.
    """

    eligible: list[str] = []
    excluded: list[dict[str, str]] = []
    for extension_id, entry in (settings or {}).items():
        if _location(entry) in _EXCLUDED_LOCATIONS:
            excluded.append(
                {"id": extension_id, "reason": "policy-or-component-extension"}
            )
            continue
        if (
            isinstance(entry, Mapping)
            and entry.get("was_installed_by_default") is True
            and not entry.get("manifest")
        ):
            excluded.append({"id": extension_id, "reason": "default-extension"})
            continue
        eligible.append(extension_id)
    return {"eligible": eligible, "excluded": excluded}


def _copy_extension_files(
    source_dir: Path, target_dir: Path, extension_id: str
) -> bool:
    source = source_dir / extension_id
    if not source.exists():
        return False
    target_dir.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target_dir / extension_id, dirs_exist_ok=True)
    return True


def migrate_extensions(
    *, source_profile_dir: PathLike, target_profile_dir: PathLike
) -> dict[str, Any]:
    """Copy eligible extensions and their settings into the target profile."""

    skipped: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    source_profile = Path(source_profile_dir)
    target_profile = Path(target_profile_dir)
    source_extensions = source_profile / "Extensions"
    if not source_extensions.exists():
        return {"migrated": 0, "skipped": [], "warnings": []}

    secure_prefs = read_json_if_present(source_profile / _SECURE_PREFERENCES)
    extensions_section = (
        secure_prefs.get("extensions") if isinstance(secure_prefs, Mapping) else None
    )
    settings_value = (
        extensions_section.get("settings")
        if isinstance(extensions_section, Mapping)
        else None
    )
    settings: Mapping[str, Any] = (
        settings_value if isinstance(settings_value, Mapping) else {}
    )

    if settings:
        selection = select_migratable_extensions(settings)
        eligible = selection["eligible"]
        excluded = selection["excluded"]
    else:
        # No settings map (for example a snapshot without Secure Preferences):
        # fall back to the directory listing, sorted for a stable order.
        eligible = sorted(
            entry.name
            for entry in source_extensions.iterdir()
            if entry.is_dir() and entry.name != "Temp"
        )
        excluded = []

    for exclusion in excluded:
        skipped.append(
            {
                "type": "extensions",
                "item": exclusion["id"],
                "reason": exclusion["reason"],
            }
        )

    target_extensions = target_profile / "Extensions"
    migrated_settings: dict[str, Any] = {}
    migrated = 0
    for extension_id in eligible:
        if not _copy_extension_files(
            source_extensions, target_extensions, extension_id
        ):
            skipped.append(
                {"type": "extensions", "item": extension_id, "reason": "files-missing"}
            )
            continue
        if settings.get(extension_id):
            migrated_settings[extension_id] = settings[extension_id]
        migrated += 1

    if migrated > 0:
        if migrated_settings:
            target_secure_path = target_profile / _SECURE_PREFERENCES
            target_secure = read_json_if_present(target_secure_path)
            if not isinstance(target_secure, dict):
                target_secure = {}
            if not isinstance(target_secure.get("extensions"), dict):
                target_secure["extensions"] = {}
            existing = target_secure["extensions"].get("settings")
            target_secure["extensions"]["settings"] = {
                **(existing if isinstance(existing, dict) else {}),
                **migrated_settings,
            }
            target_profile.mkdir(parents=True, exist_ok=True)
            write_compact_json(target_secure_path, target_secure)
        warnings.append(
            {
                "type": "extensions",
                "item": "Secure Preferences MAC",
                "reason": "mac-will-not-validate",
                "detail": _MAC_WARNING_DETAIL,
            }
        )
    return {"migrated": migrated, "skipped": skipped, "warnings": warnings}
