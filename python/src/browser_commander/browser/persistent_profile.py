"""A profile directory is permanent storage: all cookies, session ones
included, survive restarts (issue #187).

Chromium deletes cookies without an expiry date when its profile starts,
unless the last exit was a crash or the startup setting is "Continue where you
left off" (``ProfileImpl::ShouldRestoreOldSessionCookies``). A normal
``close()`` is a clean exit, so a persistent profile lost every session login
on each restart. ``--restore-last-session`` turns that setting on for one
launch, and the browser's own encrypted cookie store keeps the cookies; no
extra file is written (measured with Chrome for Testing 153 and Google Chrome
155, experiments/issue-187/raw-chrome.mjs). Same module as
``js/src/browser/persistent-profile.js``.
"""

from __future__ import annotations

import os
import shutil
from collections.abc import Sequence
from pathlib import Path
from types import MappingProxyType
from typing import Any

from browser_commander.browser.profile_directory import assert_profile_directory_name

#: The Chromium switch that keeps session cookies of a persistent profile.
KEEP_SESSION_COOKIES_SWITCH = "--restore-last-session"

#: The field trial that makes Chrome for Testing continue the last session by
#: default (``SessionRestoreInfobar.Enabled_ContinueDefault``). It keeps
#: session cookies without any switch, so the explicit opt-out turns it off.
CONTINUE_SESSION_FEATURE = "SessionRestoreInfobar"

#: Firefox keeps session cookies through SessionStore when it restores the
#: previous session at startup ("Open previous windows and tabs"); geckodriver
#: writes ``browser.startup.page = 0`` otherwise (measured with Firefox 158 and
#: geckodriver 0.37.1, experiments/issue-187/firefox.mjs).
FIREFOX_KEEP_SESSION_COOKIES_PREFERENCES = MappingProxyType({"browser.startup.page": 3})

#: The files a Chromium profile directory restores the last session's tabs
#: from: ``Sessions/`` in current releases, the four legacy files before it.
#: Cookies are kept in ``Cookies``, so deleting these only drops the tabs.
SESSION_RESTORE_FILES: tuple[str, ...] = (
    "Sessions",
    "Current Session",
    "Current Tabs",
    "Last Session",
    "Last Tabs",
)


def _assert_optional_boolean(value: Any, name: str) -> None:
    if value is not None and not isinstance(value, bool):
        raise TypeError(f"{name} must be a boolean")


def validate_session_cookie_options(
    keep_session_cookies: Any = None, restore_tabs: Any = None
) -> None:
    """Validate the launch options of this module before anything starts."""

    _assert_optional_boolean(keep_session_cookies, "keep_session_cookies")
    _assert_optional_boolean(restore_tabs, "restore_tabs")


def resolve_keep_session_cookies(
    keep_session_cookies: bool | None, *, temporary_profile: bool
) -> bool | None:
    """Whether a launch keeps session cookies: the caller's choice, otherwise
    yes for a persistent profile; ``None`` for a temporary profile without an
    explicit choice, which keeps today's command line."""

    _assert_optional_boolean(keep_session_cookies, "keep_session_cookies")
    if keep_session_cookies is not None:
        return keep_session_cookies
    return None if temporary_profile else True


def persistent_profile_args(*, keep_session_cookies: bool = True) -> list[str]:
    """The Chromium switches for a persistent profile, for apps that start the
    browser themselves and attach over CDP. Combine with
    :func:`clear_restored_tabs` to start with one tab.

    ``keep_session_cookies=False`` asks for Chromium's default of deleting
    session cookies at startup.
    """

    _assert_optional_boolean(keep_session_cookies, "keep_session_cookies")
    if keep_session_cookies is False:
        return [f"--disable-features={CONTINUE_SESSION_FEATURE}"]
    return [KEEP_SESSION_COOKIES_SWITCH]


def session_cookie_args(keep_session_cookies: bool | None) -> list[str]:
    """The switches for a resolved choice; none when it is ``None``."""

    if keep_session_cookies is None:
        return []
    return persistent_profile_args(keep_session_cookies=keep_session_cookies)


def profile_directory_from_args(args: Sequence[str] = ()) -> str:
    """The ``--profile-directory`` an argument list selects, ``Default`` otherwise."""

    prefix = "--profile-directory="
    selected = [argument for argument in args if argument.startswith(prefix)]
    return selected[-1][len(prefix) :] if selected else "Default"


def clear_restored_tabs(
    user_data_dir: str | os.PathLike[str], *, profile_directory: str = "Default"
) -> None:
    """Delete the tabs a Chromium profile would restore, keeping its cookies,
    so ``--restore-last-session`` starts with the start URL only."""

    assert_profile_directory_name(profile_directory)
    profile = Path(user_data_dir) / profile_directory
    for name in SESSION_RESTORE_FILES:
        target = profile / name
        if target.is_dir() and not target.is_symlink():
            shutil.rmtree(target, ignore_errors=True)
        else:
            target.unlink(missing_ok=True)


def prepare_session_restore(
    user_data_dir: str | os.PathLike[str],
    *,
    keep_session_cookies: bool | None,
    restore_tabs: bool = False,
    args: Sequence[str] = (),
) -> None:
    """Prepare a Chromium profile for a launch that keeps session cookies:
    unless ``restore_tabs`` is true the last session's tabs are deleted first,
    so the driven tab is the only one."""

    if keep_session_cookies is True and restore_tabs is not True:
        clear_restored_tabs(
            user_data_dir, profile_directory=profile_directory_from_args(args)
        )


def session_cookie_warning(reason: str, detail: str) -> dict[str, str]:
    """A launch-result warning that session cookies are not kept."""

    return {"item": "keep_session_cookies", "reason": reason, "detail": detail}
