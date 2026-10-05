"""Migrate a real browser profile into a dedicated automation profile.

:func:`migrate_profile` is the entry point; the submodules implement one data
class each (cookies, bookmarks, history, passwords, preferences, extensions)
plus native Safari/Firefox translations and shared OSCrypt/NSS key handling.
All 18 recognized classes receive counts and explicit unsupported reports.
"""

from browser_commander.browser.migration.bookmarks import (
    count_bookmarks,
    migrate_bookmarks,
)
from browser_commander.browser.migration.chromium_crypto import (
    create_windows_profile_key,
    encrypt_chromium_value,
)
from browser_commander.browser.migration.cookies import (
    DBSC_BOUND_COOKIE_NAMES,
    is_dbsc_bound_cookie,
    migrate_cookies,
)
from browser_commander.browser.migration.extensions import (
    migrate_extensions,
    select_migratable_extensions,
)
from browser_commander.browser.migration.firefox import (
    migrate_firefox_bookmarks,
    migrate_firefox_passwords,
    read_firefox_cookies,
    report_firefox_history,
)
from browser_commander.browser.migration.firefox_bookmarks import (
    firefox_bookmarks_to_chrome,
)
from browser_commander.browser.migration.firefox_nss import (
    PrimaryPasswordError,
    decrypt_firefox_field,
    recover_firefox_key,
    recover_firefox_key_from_database,
)
from browser_commander.browser.migration.history import migrate_history
from browser_commander.browser.migration.os_crypt_keys import (
    create_source_key_resolver,
    local_state_path_for_profile,
    resolve_target_key,
)
from browser_commander.browser.migration.passwords import migrate_passwords
from browser_commander.browser.migration.preferences import (
    MIGRATED_PREFERENCE_PATHS,
    merge_preference_subset,
    migrate_preferences,
)
from browser_commander.browser.migration.profile import (
    ALL_DATA_CLASSES,
    migrate_profile,
    migrate_profile_sync,
)
from browser_commander.browser.migration.sqlite_snapshot import (
    read_database_snapshot,
    with_database_snapshot,
)

__all__ = [
    "ALL_DATA_CLASSES",
    "DBSC_BOUND_COOKIE_NAMES",
    "MIGRATED_PREFERENCE_PATHS",
    "PrimaryPasswordError",
    "count_bookmarks",
    "create_source_key_resolver",
    "create_windows_profile_key",
    "decrypt_firefox_field",
    "encrypt_chromium_value",
    "firefox_bookmarks_to_chrome",
    "is_dbsc_bound_cookie",
    "local_state_path_for_profile",
    "merge_preference_subset",
    "migrate_bookmarks",
    "migrate_cookies",
    "migrate_extensions",
    "migrate_firefox_bookmarks",
    "migrate_firefox_passwords",
    "migrate_history",
    "migrate_passwords",
    "migrate_preferences",
    "migrate_profile",
    "migrate_profile_sync",
    "read_database_snapshot",
    "read_firefox_cookies",
    "recover_firefox_key",
    "recover_firefox_key_from_database",
    "report_firefox_history",
    "resolve_target_key",
    "select_migratable_extensions",
    "with_database_snapshot",
]
