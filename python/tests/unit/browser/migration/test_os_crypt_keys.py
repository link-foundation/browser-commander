"""Tests for OSCrypt key resolution (mirrors os-crypt-keys.test.js).

The OS credential stores (Keychain, libsecret/KWallet, DPAPI) are replaced by
injected fakes, so these run on any platform.
"""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

import pytest

from browser_commander.browser.browser_cookie_crypto import derive_chromium_cookie_key
from browser_commander.browser.migration.os_crypt_keys import (
    create_source_key_resolver,
    local_state_path_for_profile,
    resolve_target_key,
)
from tests.helpers.migration_fixtures import write_local_state


class TestCreateSourceKeyResolver:
    def test_uses_the_hardcoded_key_for_linux_v10(self) -> None:
        def read_safe_storage_password(**_options: Any) -> str:
            raise AssertionError("v10 must not ask the keyring")

        resolve = create_source_key_resolver(
            browser="chromium",
            platform="linux",
            read_safe_storage_password=read_safe_storage_password,
        )
        assert resolve("v10") == derive_chromium_cookie_key("peanuts", "linux")

    def test_derives_the_safe_storage_key_for_linux_v11_and_caches_it(self) -> None:
        calls: list[dict[str, Any]] = []

        def read_safe_storage_password(**options: Any) -> str:
            calls.append(options)
            return "keyring-pass"

        resolve = create_source_key_resolver(
            browser="chrome",
            platform="linux",
            environment={"HOME": "/home/fixture"},
            read_safe_storage_password=read_safe_storage_password,
        )
        first = resolve("v11")
        second = resolve("v11")

        assert first == derive_chromium_cookie_key("keyring-pass", "linux")
        assert second == first
        assert len(calls) == 1
        assert calls[0] == {
            "browser": "chrome",
            "platform": "linux",
            "environment": {"HOME": "/home/fixture"},
        }

    def test_reads_the_windows_key_from_local_state(self) -> None:
        windows_key = bytes([9]) * 32
        seen: list[Path] = []

        def read_windows_encryption_key(**options: Any) -> bytes:
            seen.append(options["local_state_path"])
            return windows_key

        resolve = create_source_key_resolver(
            browser="chrome",
            platform="win32",
            local_state_path="/fake/Local State",
            read_windows_encryption_key=read_windows_encryption_key,
        )

        assert resolve("v10") == windows_key
        assert seen == [Path("/fake/Local State")]

    def test_unwraps_the_dpapi_key_from_a_real_local_state(
        self, tmp_path: Path
    ) -> None:
        windows_key = bytes(range(32))
        protected = b"PROTECTED:" + windows_key
        local_state = write_local_state(
            tmp_path,
            {
                "os_crypt": {
                    "encrypted_key": base64.b64encode(b"DPAPI" + protected).decode()
                }
            },
        )

        def decrypt_windows_dpapi(value: bytes, **_options: Any) -> bytes:
            assert value == protected
            return value[len(b"PROTECTED:") :]

        resolve = create_source_key_resolver(
            browser="edge",
            platform="win32",
            local_state_path=local_state,
            decrypt_windows_dpapi=decrypt_windows_dpapi,
        )

        assert resolve("v10") == windows_key

    def test_rejects_a_local_state_key_without_the_dpapi_tag(
        self, tmp_path: Path
    ) -> None:
        local_state = write_local_state(
            tmp_path,
            {"os_crypt": {"encrypted_key": base64.b64encode(b"NOTAG").decode()}},
        )
        resolve = create_source_key_resolver(
            browser="chrome",
            platform="win32",
            local_state_path=local_state,
            decrypt_windows_dpapi=lambda value, **_options: value,
        )
        with pytest.raises(RuntimeError, match="DPAPI prefix"):
            resolve("v10")

    def test_derives_the_macos_safe_storage_key(self) -> None:
        resolve = create_source_key_resolver(
            browser="chrome",
            platform="darwin",
            read_safe_storage_password=lambda **_options: "mac-pass",
        )
        key = resolve("v10")
        assert key == derive_chromium_cookie_key("mac-pass", "darwin")
        # macOS uses 1003 PBKDF2 iterations, Linux one.
        assert key != derive_chromium_cookie_key("mac-pass", "linux")

    def test_rejects_unsupported_platforms(self) -> None:
        resolve = create_source_key_resolver(browser="chrome", platform="sunos")
        with pytest.raises(ValueError, match="unsupported on sunos"):
            resolve("v10")


class TestResolveTargetKey:
    @pytest.mark.parametrize("platform", ["darwin", "linux"])
    def test_derives_the_launching_profile_key_on_macos_and_linux(
        self, platform: str
    ) -> None:
        result = resolve_target_key(
            browser="chrome",
            platform=platform,
            read_safe_storage_password=lambda **_options: "target-pass",
        )
        assert result["key"] == derive_chromium_cookie_key("target-pass", platform)
        assert result["prefix"] == "v11"

    def test_refuses_to_derive_a_windows_key(self) -> None:
        with pytest.raises(ValueError, match="create_windows_profile_key"):
            resolve_target_key(browser="chrome", platform="win32")


class TestLocalStatePathForProfile:
    def test_points_at_local_state_next_to_the_profile_directory(
        self, tmp_path: Path
    ) -> None:
        profile = tmp_path / "google-chrome" / "Default"
        assert local_state_path_for_profile(profile) == profile.parent / "Local State"
