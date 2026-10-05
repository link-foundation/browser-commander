import pytest

from browser_commander.browser.migration.profile import migrate_profile_sync


@pytest.mark.parametrize(
    "options",
    [
        {"include": ["invented"]},
        {"domains": ["https://example.com"]},
        {"target_browser": "firefox", "include": ["bookmarks"]},
    ],
)
def test_validation_precedes_mutation(tmp_path, options):
    with pytest.raises((ValueError, TypeError)):
        migrate_profile_sync(from_={"browser": "chrome"}, to=tmp_path, **options)
    assert list(tmp_path.iterdir()) == []


def test_overlap_rejected_before_source_mutation(tmp_path):
    with pytest.raises(ValueError, match="overlap"):
        migrate_profile_sync(
            from_={"browser": "opera", "user_data_dir": tmp_path},
            to=tmp_path,
            include=["bookmarks"],
        )
    assert list(tmp_path.iterdir()) == []


def test_detection_only_source_precedes_mutation(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    target = tmp_path / "target"
    with pytest.raises(ValueError, match="detection"):
        migrate_profile_sync(
            from_={"browser": "duckduckgo", "user_data_dir": source},
            to=target,
            include=["history"],
        )
    assert not target.exists()
