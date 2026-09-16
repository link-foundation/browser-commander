"""Where managed downloads are written (issue #88).

The directory is resolved, created and probed for writability *before* the
first download starts, because a permission problem discovered after a click
looks like a missing file and gets blamed on the page.
"""

from __future__ import annotations

import os
import re
import sys
import tempfile
from pathlib import Path


class DownloadDirectoryPreset:
    """Presets accepted in place of an absolute path."""

    #: The directory the user's browser downloads into.
    USER_DOWNLOADS = "user-downloads"
    #: A per-machine temporary directory.
    TEMPORARY = "temporary"


#: Owner-only file mode for saved artifacts.
ARTIFACT_FILE_MODE = 0o600

#: Owner-only directory mode for the download root.
ARTIFACT_DIRECTORY_MODE = 0o700

_XDG_DOWNLOAD_DIR = re.compile(r'^\s*XDG_DOWNLOAD_DIR\s*=\s*"(.*)"\s*$', re.MULTILINE)


def _xdg_download_directory() -> str | None:
    """Read the XDG user directory configuration.

    Linux users move their Downloads folder and localize its name; reading
    ``user-dirs.dirs`` is what makes ``user-downloads`` mean their folder
    rather than an English path that happens to exist.

    Returns:
        Configured download directory, when one is configured
    """
    config_home = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    try:
        contents = Path(config_home, "user-dirs.dirs").read_text(encoding="utf-8")
    except OSError:
        return None

    match = _XDG_DOWNLOAD_DIR.search(contents)
    if not match:
        return None

    return re.sub(r"^\$HOME", str(Path.home()), match.group(1))


def resolve_download_directory(
    directory: str | os.PathLike[str] | None = None,
) -> str:
    """Resolve a download directory setting to an absolute path.

    Args:
        directory: Absolute path or a preset

    Returns:
        Absolute directory path

    Raises:
        TypeError: When the setting is not a path or a known preset
        ValueError: When a path is given but is not absolute
    """
    if directory is None:
        directory = DownloadDirectoryPreset.USER_DOWNLOADS

    if directory == DownloadDirectoryPreset.TEMPORARY:
        return str(Path(tempfile.gettempdir(), "browser-commander-downloads"))

    if directory == DownloadDirectoryPreset.USER_DOWNLOADS:
        configured = _xdg_download_directory() if sys.platform == "linux" else None
        return configured or str(Path.home() / "Downloads")

    if not isinstance(directory, (str, os.PathLike)) or not str(directory):
        msg = (
            "downloads directory must be an absolute path, "
            "'user-downloads' or 'temporary'"
        )
        raise TypeError(msg)

    if not Path(directory).is_absolute():
        msg = f'downloads directory must be absolute, received "{directory}"'
        raise ValueError(msg)

    return str(Path(directory).resolve())


def prepare_download_directory(root: str | os.PathLike[str]) -> str:
    """Create the download directory and prove it can be written to.

    A directory that exists is not the same as a directory we may write in, so
    the probe writes and removes a file rather than trusting the mode bits.

    Args:
        root: Absolute download directory

    Returns:
        The same directory, once it is usable

    Raises:
        OSError: When the directory cannot be created or written to
    """
    try:
        Path(root).mkdir(parents=True, exist_ok=True, mode=ARTIFACT_DIRECTORY_MODE)
    except OSError as error:
        msg = f"download directory {root} could not be created: {error}"
        raise OSError(msg) from error

    probe = Path(root, f".browser-commander-probe-{os.getpid()}")
    try:
        probe.touch(mode=ARTIFACT_FILE_MODE)
    except OSError as error:
        msg = f"download directory {root} is not writable: {error}"
        raise OSError(msg) from error
    finally:
        probe.unlink(missing_ok=True)

    return str(root)
