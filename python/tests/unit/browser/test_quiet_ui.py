from browser_commander.browser.restrictions import resolve_restrictions


def test_quiet_ui_merges_features_and_seeds_preferences():
    result = resolve_restrictions(
        ["quiet-ui"], disable_features=["Custom", "Translate"]
    )
    features = [arg for arg in result.args if arg.startswith("--disable-features=")]
    assert len(features) == 1
    assert "SessionRestoreInfobar" in features[0]
    assert "Custom" in features[0]
    assert features[0].count("Translate") == 1
    assert result.preferences["translate"]["enabled"] is False
    assert result.preferences["profile"]["password_manager_enabled"] is False
