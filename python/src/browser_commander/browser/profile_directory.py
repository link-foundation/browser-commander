"""Create, prepare and delete the user data directories Chrome is started with."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import time
from collections.abc import Mapping
from pathlib import Path
from types import MappingProxyType
from typing import Any

#: Chrome skips its first-run experience when this file exists in the user data
#: directory; it is what Chrome itself writes after the first run. Writing it
#: keeps ``--no-first-run`` off the command line (issue #103), and a headful
#: launch needs it: without it the first-run dialog holds startup and the
#: DevTools endpoint never appears.
FIRST_RUN_SENTINEL = "First Run"

#: Chrome's profile-wide settings file, next to the profile directories.
LOCAL_STATE_FILE = "Local State"

#: Local State written into a brand-new user data directory. With only the
#: First Run sentinel, Chrome treats a new directory like a browser that was
#: just updated and opens a "What's new" tab that takes the foreground after the
#: engine has attached. A ``last_whats_new_version`` no release has reached
#: keeps that tab closed.
#:
#: Microsoft Edge ignores both and opens its own first-run tab,
#: ``edge://welcome-edge/``, which takes the foreground the same way; it is
#: skipped once Edge has recorded ``fre.has_user_seen_fre`` (measured with Edge
#: 153, experiments/issue-103/edge-first-run.sh). Chrome ignores the key.
INITIAL_LOCAL_STATE: Mapping[str, Any] = MappingProxyType(
    {
        "browser": MappingProxyType({"last_whats_new_version": 9999}),
        "fre": MappingProxyType({"has_user_seen_fre": True}),
    }
)

#: Prefix of the fresh profiles Browser Commander creates and deletes.
TEMPORARY_PROFILE_PREFIX = "browser-commander-profile-"


def _plain(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: _plain(item) for key, item in value.items()}
    return value


def prepare_user_data_dir(user_data_dir: str | os.PathLike[str]) -> str:
    """Make sure a user data directory exists and has the First Run sentinel.

    An existing sentinel is left alone, so a profile Chrome already used keeps
    its timestamp, and Local State is only written when Chrome has not written
    one yet.

    Returns:
        The same directory, as a string.
    """

    directory = Path(user_data_dir)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / FIRST_RUN_SENTINEL).touch(exist_ok=True)
    try:
        with (directory / LOCAL_STATE_FILE).open("x", encoding="utf-8") as handle:
            json.dump(_plain(INITIAL_LOCAL_STATE), handle, separators=(",", ":"))
    except FileExistsError:
        pass
    return os.fspath(user_data_dir)


def create_temporary_user_data_dir(
    *, parent: str | os.PathLike[str] | None = None
) -> str:
    """Create a fresh, prepared profile for one launch.

    Args:
        parent: Directory to create it in; the system temp directory by default.
    """

    directory = tempfile.mkdtemp(
        prefix=TEMPORARY_PROFILE_PREFIX,
        dir=None if parent is None else os.fspath(parent),
    )
    return prepare_user_data_dir(directory)


def remove_user_data_dir(
    user_data_dir: str | os.PathLike[str],
    *,
    retries: int = 5,
    retry_delay: float = 0.2,
) -> None:
    """Delete a temporary profile.

    Chrome can still be flushing files for a moment after its process exits,
    so removal is retried. A directory that is already gone is not an error.
    """

    for attempt in range(retries + 1):
        try:
            shutil.rmtree(user_data_dir)
            return
        except FileNotFoundError:
            return
        except OSError:
            if attempt >= retries:
                raise
            time.sleep(retry_delay)
