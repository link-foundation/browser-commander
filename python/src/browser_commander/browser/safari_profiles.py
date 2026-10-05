"""Safari named profiles use separate Safari and WebKit directories."""

from __future__ import annotations

import contextlib
import re
import sqlite3
from pathlib import Path


def list_safari_profiles(browser, root):
    # Delay imports to avoid initializing the migration API during discovery imports.
    from .browser_profiles import BrowserProfile
    from .migration.safari import with_safari_access
    from .safari_cookies import find_safari_cookie_file

    def find_file(candidates):
        for candidate in candidates:
            try:
                if candidate.stat().st_mode & 0o170000 == 0o100000:
                    return candidate
            except PermissionError:
                return candidate
            except (FileNotFoundError, NotADirectoryError):
                continue
        return None

    root = Path(root)
    profiles = []
    default_file = find_safari_cookie_file(root) or find_file(
        [
            root / "Safari/History.db",
            root / "History.db",
            root / "Safari/Bookmarks.plist",
            root / "Bookmarks.plist",
        ]
    )
    if default_file:
        profiles.append(BrowserProfile(browser, "Default", "Default", root, True))
    tabs = find_file([root / "Safari/SafariTabs.db", root / "SafariTabs.db"])
    if tabs is None:
        return profiles

    def read():
        with tabs.open("rb"):
            pass
        with contextlib.closing(
            sqlite3.connect(f"{tabs.resolve().as_uri()}?mode=ro", uri=True)
        ) as db:
            return db.execute(
                "SELECT DISTINCT external_uuid,title FROM bookmarks WHERE subtype=2 AND external_uuid != 'DefaultProfile' ORDER BY external_uuid"
            ).fetchall()

    try:
        rows = with_safari_access(tabs, read)
    except (OSError, sqlite3.Error, ValueError) as error:
        profiles.append(
            BrowserProfile(
                browser,
                "Profiles",
                "Safari profile discovery",
                root,
                False,
                error=str(error),
            )
        )
        return profiles
    for uuid, title in rows:
        if not isinstance(uuid, str) or not re.fullmatch(
            r"[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}", uuid, re.IGNORECASE
        ):
            continue
        name = uuid.upper()
        profiles.append(
            BrowserProfile(
                browser, name, title or name, root / "Safari/Profiles" / name, False
            )
        )
    return profiles
