import sys
from pathlib import Path

import pytest

from browser_commander.browser.browser_sources import (
    BROWSER_SOURCES,
    resolve_browser_protection_roots,
    resolve_browser_roots,
)
from browser_commander.browser.system_browser import (
    CHANNEL_EXECUTABLE_NAMES,
    assert_dedicated_user_data_dir,
)


@pytest.mark.parametrize(
    "directory",
    [
        "Library/Application Support/package-registry-manager/browser-profile",
        "Library/Safari-backup/profile",
        "Library/Cookies-backup/profile",
        "Library/Containers/com.apple.Safari-helper/profile",
    ],
)
def test_dedicated_macos_application_profiles_are_accepted(directory):
    assert_dedicated_user_data_dir(
        "/users/test/" + directory,
        platform="darwin",
        home_dir="/users/test",
        environment={},
    )


@pytest.mark.parametrize(
    "directory",
    [
        "Library/Safari",
        "Library/Cookies",
        "Library/Containers/com.apple.Safari",
        "Library/Safari Technology Preview",
        "Library/Containers/com.apple.SafariTechnologyPreview",
        "Library/Application Support/Google/Chrome/Default",
    ],
)
def test_safari_stores_and_chrome_profiles_are_protected(directory):
    root = "/users/test/" + directory
    for requested in [root, root + "/new-profile"]:
        with pytest.raises(ValueError, match=r"dedicated.*default profile"):
            assert_dedicated_user_data_dir(
                requested, platform="darwin", home_dir="/users/test", environment={}
            )


def test_catalogue_chromium_channels_and_aliases():
    for browser in BROWSER_SOURCES:
        if browser["family"] != "chromium":
            continue
        assert CHANNEL_EXECUTABLE_NAMES.get(browser["id"]), browser["id"]
        for alias in browser.get("aliases", []):
            assert (
                CHANNEL_EXECUTABLE_NAMES[alias]
                == CHANNEL_EXECUTABLE_NAMES[browser["id"]]
            )


@pytest.mark.skipif(
    sys.platform == "win32", reason="symlinks require Windows privileges"
)
def test_new_profile_under_default_root_symlink_is_protected(tmp_path):
    root = Path(resolve_browser_roots("chrome", home_dir=tmp_path, environment={})[0])
    root.mkdir(parents=True)
    alias = tmp_path / "profile-alias"
    alias.symlink_to(root, target_is_directory=True)
    with pytest.raises(ValueError, match=r"dedicated.*default profile"):
        assert_dedicated_user_data_dir(
            alias / "new-profile", home_dir=tmp_path, environment={}
        )


@pytest.mark.parametrize("platform", ["linux", "darwin", "win32"])
def test_all_protection_roots_and_descendants_are_protected(platform):
    home = r"C:\Users\test" if platform == "win32" else "/users/test"
    for browser in BROWSER_SOURCES:
        roots = resolve_browser_protection_roots(
            browser["id"], platform=platform, home_dir=home, environment={}
        )
        if "protectionRoots" not in browser:
            assert roots == resolve_browser_roots(
                browser["id"], platform=platform, home_dir=home, environment={}
            )
        for root in roots:
            for directory in [
                root,
                root + ("\\" if platform == "win32" else "/") + "Profile 1",
            ]:
                with pytest.raises(ValueError, match=r"dedicated.*default profile"):
                    assert_dedicated_user_data_dir(
                        directory, platform=platform, home_dir=home, environment={}
                    )
