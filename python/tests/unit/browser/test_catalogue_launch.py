import pytest

from browser_commander.browser.browser_sources import (
    BROWSER_SOURCES,
    resolve_browser_roots,
)
from browser_commander.browser.system_browser import (
    CHANNEL_EXECUTABLE_NAMES,
    assert_dedicated_user_data_dir,
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


@pytest.mark.parametrize("platform", ["linux", "darwin", "win32"])
def test_all_roots_and_descendants_are_protected(platform):
    home = r"C:\Users\test" if platform == "win32" else "/users/test"
    for browser in BROWSER_SOURCES:
        for root in resolve_browser_roots(
            browser["id"], platform=platform, home_dir=home, environment={}
        ):
            for directory in [
                root,
                root + ("\\" if platform == "win32" else "/") + "Profile 1",
            ]:
                with pytest.raises(ValueError, match=r"dedicated.*default profile"):
                    assert_dedicated_user_data_dir(
                        directory, platform=platform, home_dir=home, environment={}
                    )
