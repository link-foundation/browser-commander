from browser_commander.browser.migration.os_crypt_keys import (
    local_state_path_for_profile,
)


def test_single_profile_local_state_precedes_parent(tmp_path):
    profile = tmp_path / "Opera Stable"
    profile.mkdir()
    (tmp_path / "Local State").write_text("{}")
    (profile / "Local State").write_text('{"os_crypt":{}}')
    assert local_state_path_for_profile(profile) == profile / "Local State"
