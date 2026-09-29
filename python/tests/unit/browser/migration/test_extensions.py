"""Tests for Chromium extension migration (mirrors extensions.test.js)."""

from __future__ import annotations

from typing import TYPE_CHECKING

from browser_commander.browser.migration.extensions import (
    migrate_extensions,
    select_migratable_extensions,
)
from tests.helpers.migration_fixtures import (
    migrate_between,
    read_profile_json,
    write_chromium_extension,
    write_profile_json,
)

if TYPE_CHECKING:
    from pathlib import Path

EXTENSION_A = "a" * 32
EXTENSION_C = "c" * 32
EXTENSION_D = "d" * 32


class TestSelectMigratableExtensions:
    def test_excludes_policy_installed_and_component_extensions(self) -> None:
        selection = select_migratable_extensions(
            {
                "user": {"location": 1},
                "component": {"location": 5},
                "policy": {"location": 7},
                "external": {"location": 10},
            }
        )
        assert selection["eligible"] == ["user"]
        assert len(selection["excluded"]) == 3
        assert all(
            entry["reason"] == "policy-or-component-extension"
            for entry in selection["excluded"]
        )

    def test_excludes_default_extensions_without_a_manifest(self) -> None:
        selection = select_migratable_extensions(
            {
                "default": {"location": 1, "was_installed_by_default": True},
                "kept": {
                    "location": 1,
                    "was_installed_by_default": True,
                    "manifest": {"name": "kept"},
                },
            }
        )
        assert selection["eligible"] == ["kept"]
        assert selection["excluded"] == [
            {"id": "default", "reason": "default-extension"}
        ]


class TestMigrateExtensions:
    def test_copies_eligible_extension_files_and_warns_about_the_mac(
        self, tmp_path: Path
    ) -> None:
        source = tmp_path / "source"
        target = tmp_path / "target"
        write_chromium_extension(source, EXTENSION_A, "1.0")
        write_chromium_extension(source, EXTENSION_C, "2.0")
        write_profile_json(
            source,
            "Secure Preferences",
            {
                "extensions": {
                    "settings": {
                        EXTENSION_A: {"location": 1, "manifest": {}},
                        EXTENSION_C: {"location": 5},
                    }
                }
            },
        )

        report = migrate_between(migrate_extensions, source, target)

        assert report["migrated"] == 1
        assert any(
            entry["item"] == EXTENSION_C
            and entry["reason"] == "policy-or-component-extension"
            for entry in report["skipped"]
        )
        assert report["warnings"][0]["reason"] == "mac-will-not-validate"

        copied = (
            target / "Extensions" / EXTENSION_A / "1.0" / "manifest.json"
        ).read_text(encoding="utf-8")
        assert "manifest_version" in copied
        assert not (target / "Extensions" / EXTENSION_C).exists()

        target_secure = read_profile_json(target, "Secure Preferences")
        assert target_secure["extensions"]["settings"][EXTENSION_A]
        assert EXTENSION_C not in target_secure["extensions"]["settings"]

    def test_keeps_existing_target_secure_preferences(self, tmp_path: Path) -> None:
        source = tmp_path / "source"
        target = tmp_path / "target"
        target.mkdir()
        write_chromium_extension(source, EXTENSION_A, "1.0")
        write_profile_json(
            source,
            "Secure Preferences",
            {"extensions": {"settings": {EXTENSION_A: {"location": 1}}}},
        )
        write_profile_json(
            target,
            "Secure Preferences",
            {
                "protection": {"macs": {}},
                "extensions": {"settings": {EXTENSION_D: {"location": 1}}},
            },
        )

        migrate_between(migrate_extensions, source, target)

        merged = read_profile_json(target, "Secure Preferences")
        assert merged["protection"] == {"macs": {}}
        assert set(merged["extensions"]["settings"]) == {EXTENSION_A, EXTENSION_D}

    def test_falls_back_to_the_directory_listing_without_secure_preferences(
        self, tmp_path: Path
    ) -> None:
        source = tmp_path / "source"
        target = tmp_path / "target"
        write_chromium_extension(source, EXTENSION_D, "1.0")

        report = migrate_between(migrate_extensions, source, target)

        assert report["migrated"] == 1
        assert (target / "Extensions" / EXTENSION_D / "1.0" / "manifest.json").exists()

    def test_reports_nothing_when_there_is_no_extensions_directory(
        self, tmp_path: Path
    ) -> None:
        source = tmp_path / "source"
        source.mkdir()
        report = migrate_between(migrate_extensions, source, tmp_path / "target")
        assert report == {"migrated": 0, "skipped": [], "warnings": []}
