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


def test_no_promos_applies_only_promo_features_and_split_view_preference() -> None:
    result = resolve_restrictions(
        ["no-promos"], disable_features=["Custom", "PromotionalTabs"]
    )
    assert result.args == ["--disable-features=Custom,PromotionalTabs,ChromeWhatsNewUI"]
    assert result.preferences == {
        "browser": {"split_view_drag_and_drop_enabled": False}
    }
