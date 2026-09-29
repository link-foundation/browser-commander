"""Tests for OSCrypt value encryption (mirrors chromium-crypto.test.js).

Covers the macOS (PBKDF2 over 1003 iterations, AES-128-CBC), Linux (1
iteration, ``v10``/``v11``) and Windows (AES-256-GCM) formats.
"""

from __future__ import annotations

import base64
import os

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from browser_commander.browser.browser_cookie_crypto import (
    decrypt_chromium_cookie,
    derive_chromium_cookie_key,
)
from browser_commander.browser.migration.chromium_crypto import (
    create_windows_profile_key,
    encrypt_chromium_value,
)


def _saltysalt_key(password: str, iterations: int) -> bytes:
    """Chromium's PBKDF2-HMAC-SHA1 derivation over ``saltysalt``."""

    return PBKDF2HMAC(
        algorithm=hashes.SHA1(), length=16, salt=b"saltysalt", iterations=iterations
    ).derive(password.encode())


class TestEncryptChromiumValue:
    @pytest.mark.parametrize("platform", ["darwin", "linux"])
    def test_round_trips_through_aes_128_cbc(self, platform: str) -> None:
        key = derive_chromium_cookie_key("safe-storage-pass", platform)
        encrypted = encrypt_chromium_value(
            "hunter2", key=key, platform=platform, prefix="v11"
        )
        assert encrypted[:3] == b"v11"
        # AES-128-CBC: prefix + whole 16-byte blocks.
        assert (len(encrypted) - 3) % 16 == 0
        decrypted = decrypt_chromium_cookie(
            encrypted,
            host="accounts.example.com",
            database_version=0,
            platform=platform,
            key=key,
        )
        assert decrypted == "hunter2"

    @pytest.mark.parametrize(
        ("platform", "iterations"), [("darwin", 1003), ("linux", 1)]
    )
    def test_uses_chromiums_key_derivation(
        self, platform: str, iterations: int
    ) -> None:
        key = derive_chromium_cookie_key("keychain-pass", platform)
        assert key == _saltysalt_key("keychain-pass", iterations)
        assert len(key) == 16

    def test_linux_v10_uses_the_peanuts_key(self) -> None:
        key = _saltysalt_key("peanuts", 1)
        encrypted = encrypt_chromium_value(
            "legacy", key=key, platform="linux", prefix="v10"
        )
        assert encrypted[:3] == b"v10"
        assert (
            decrypt_chromium_cookie(
                encrypted,
                host="a.example",
                platform="linux",
                key=derive_chromium_cookie_key("peanuts", "linux"),
            )
            == "legacy"
        )

    def test_defaults_to_the_v10_prefix(self) -> None:
        key = os.urandom(16)
        assert encrypt_chromium_value("x", key=key, platform="linux")[:3] == b"v10"

    def test_round_trips_through_aes_256_gcm_on_win32(self) -> None:
        key = os.urandom(32)
        encrypted = encrypt_chromium_value(
            "p@ssw0rd", key=key, platform="win32", prefix="v10"
        )
        assert encrypted[:3] == b"v10"
        # prefix + 12-byte nonce + ciphertext + 16-byte tag.
        assert len(encrypted) == 3 + 12 + len("p@ssw0rd") + 16
        decrypted = decrypt_chromium_cookie(
            encrypted,
            host="login.example.com",
            database_version=0,
            platform="win32",
            key=key,
        )
        assert decrypted == "p@ssw0rd"

    def test_requires_a_bytes_key_and_a_supported_platform(self) -> None:
        with pytest.raises(TypeError, match="target encryption key"):
            encrypt_chromium_value("x", key="nope", platform="linux")  # type: ignore[arg-type]
        with pytest.raises(ValueError, match="unsupported"):
            encrypt_chromium_value("x", key=os.urandom(16), platform="sunos")


class TestCreateWindowsProfileKey:
    def test_tags_the_dpapi_protected_key_and_base64_encodes_it(self) -> None:
        def encrypt_dpapi(data: bytes) -> bytes:
            return b"ENC" + data

        result = create_windows_profile_key(
            encrypt_dpapi=encrypt_dpapi, generate_key=lambda: bytes([7]) * 32
        )
        assert len(result["key"]) == 32
        decoded = base64.b64decode(result["encryptedKeyBase64"])
        assert decoded[:5] == b"DPAPI"
        assert decoded[5:8] == b"ENC"
        assert decoded[8:] == bytes([7]) * 32

    def test_generates_a_random_32_byte_key_by_default(self) -> None:
        first = create_windows_profile_key(encrypt_dpapi=lambda data: data)
        second = create_windows_profile_key(encrypt_dpapi=lambda data: data)
        assert len(first["key"]) == 32
        assert first["key"] != second["key"]

    def test_requires_an_encrypt_dpapi_function(self) -> None:
        with pytest.raises(TypeError, match="encrypt_dpapi"):
            create_windows_profile_key()
