"""Tests for Chromium bookmark migration (mirrors bookmarks.test.js)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from browser_commander.browser.migration.bookmarks import (
    count_bookmarks,
    migrate_bookmarks,
)
from tests.helpers.migration_fixtures import (
    assert_nothing_migrated,
    migrate_between,
    read_profile_json,
    write_profile_json,
)

if TYPE_CHECKING:
    from pathlib import Path

SAMPLE_BOOKMARKS: dict[str, Any] = {
    "checksum": "source-checksum",
    "roots": {
        "bookmark_bar": {
            "type": "folder",
            "children": [
                {"type": "url", "name": "A", "url": "https://a.example/"},
                {
                    "type": "folder",
                    "children": [
                        {"type": "url", "name": "B", "url": "https://b.example/"}
                    ],
                },
            ],
        },
        "other": {"type": "folder", "children": []},
    },
}


class TestCountBookmarks:
    def test_counts_url_nodes_recursively_across_roots(self) -> None:
        assert count_bookmarks(SAMPLE_BOOKMARKS) == 2

    def test_returns_zero_for_empty_or_invalid_trees(self) -> None:
        assert count_bookmarks({}) == 0
        assert count_bookmarks(None) == 0


class TestMigrateBookmarks:
    def test_copies_the_bookmarks_json_verbatim_and_reports_the_count(
        self, tmp_path: Path
    ) -> None:
        source = tmp_path / "source"
        target = tmp_path / "target"
        source.mkdir()
        write_profile_json(source, "Bookmarks", SAMPLE_BOOKMARKS)
        original = (source / "Bookmarks").read_bytes()

        report = migrate_between(migrate_bookmarks, source, target)

        assert report["migrated"] == 2
        assert report["skipped"] == []
        assert read_profile_json(target, "Bookmarks") == SAMPLE_BOOKMARKS
        assert (target / "Bookmarks").read_bytes() == original

    def test_reports_a_skip_when_the_source_has_no_bookmarks(
        self, tmp_path: Path
    ) -> None:
        report = migrate_between(
            migrate_bookmarks, tmp_path / "source", tmp_path / "target"
        )

        assert_nothing_migrated(report, "source-has-no-bookmarks")
        assert len(report["skipped"]) == 1
