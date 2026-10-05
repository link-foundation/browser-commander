"""Resolve Chromium OSCrypt keys for the source and target profiles.

The source key decrypts the values stored by the browser being migrated from;
the target key encrypts them for the dedicated profile that will be launched:

* macOS: PBKDF2 of the Keychain "Safe Storage" password (1003 iterations);
* Linux: ``v10`` values use the hard-coded ``"peanuts"`` password, ``v11``
  values the keyring "Safe Storage" password (1 iteration);
* Windows: the AES-256-GCM key in ``Local State``, protected by DPAPI. A
  target Windows key cannot be derived; the launcher creates one with
  :func:`~browser_commander.browser.migration.chromium_crypto.create_windows_profile_key`.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

from browser_commander.browser.browser_cookie_credentials import (
    decrypt_windows_dpapi as default_decrypt_windows_dpapi,
)
from browser_commander.browser.browser_cookie_credentials import (
    read_safe_storage_password as default_read_safe_storage_password,
)
from browser_commander.browser.browser_cookie_credentials import (
    read_windows_encryption_key as default_read_windows_encryption_key,
)
from browser_commander.browser.browser_cookie_crypto import derive_chromium_cookie_key
from browser_commander.browser.browser_profile_files import local_state_path_for_profile
from browser_commander.browser.migration.fs_utils import PathLike

__all__ = [
    "SourceKeyResolver",
    "create_source_key_resolver",
    "local_state_path_for_profile",
    "resolve_target_key",
]

#: ``resolve(prefix) -> key`` for a ``"v10"``/``"v11"`` value prefix.
SourceKeyResolver = Callable[[str], bytes]


def create_source_key_resolver(
    *,
    browser: str,
    platform: str,
    local_state_path: PathLike | None = None,
    environment: Mapping[str, str] | None = None,
    read_safe_storage_password: Callable[..., str] = default_read_safe_storage_password,
    read_windows_encryption_key: Callable[
        ..., bytes
    ] = default_read_windows_encryption_key,
    decrypt_windows_dpapi: Callable[..., bytes] = default_decrypt_windows_dpapi,
) -> SourceKeyResolver:
    """Build a cached ``resolve(prefix) -> bytes`` for the source profile.

    Each prefix is resolved at most once, so the OS credential store is asked
    for the password a single time per migration.
    """

    environment = os.environ if environment is None else environment
    cache: dict[str, bytes] = {}

    def derive(prefix: str) -> bytes:
        if platform == "win32":
            return read_windows_encryption_key(
                local_state_path=Path(local_state_path or "Local State"),
                environment=environment,
                decrypt_dpapi=decrypt_windows_dpapi,
            )
        if platform == "linux" and prefix == "v10":
            return derive_chromium_cookie_key("peanuts", "linux")
        if platform in ("linux", "darwin"):
            password = read_safe_storage_password(
                browser=browser, platform=platform, environment=environment
            )
            return derive_chromium_cookie_key(password, platform)
        msg = f"OSCrypt keys are unsupported on {platform}"
        raise ValueError(msg)

    def resolve(prefix: str) -> bytes:
        key = str(prefix)
        if key not in cache:
            cache[key] = derive(key)
        return cache[key]

    return resolve


def resolve_target_key(
    *,
    browser: str,
    platform: str,
    environment: Mapping[str, str] | None = None,
    read_safe_storage_password: Callable[..., str] = default_read_safe_storage_password,
) -> dict[str, Any]:
    """Derive the dedicated profile's key on macOS/Linux.

    Returns:
        ``{"key": bytes, "prefix": "v11"}``.

    Raises:
        ValueError: On Windows, where the key must be created instead.
    """

    if platform in ("darwin", "linux"):
        password = read_safe_storage_password(
            browser=browser,
            platform=platform,
            environment=os.environ if environment is None else environment,
        )
        return {"key": derive_chromium_cookie_key(password, platform), "prefix": "v11"}
    msg = (
        "resolve_target_key does not derive a Windows key; "
        "use create_windows_profile_key"
    )
    raise ValueError(msg)
