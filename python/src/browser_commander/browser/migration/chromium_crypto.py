"""Encrypt values the way Chromium's OSCrypt does, for a target profile.

Migrated passwords are decrypted with the source profile's key and
re-encrypted with the dedicated profile's key:

* macOS and Linux: ``prefix`` + AES-128-CBC (IV of 16 spaces, PKCS#7);
* Windows: ``prefix`` + 12-byte nonce + AES-256-GCM ciphertext + 16-byte tag.

On Windows the target key is a fresh random 32-byte key that the launcher
protects with DPAPI and writes into the target ``Local State``
(:func:`create_windows_profile_key`).
"""

from __future__ import annotations

import base64
import os
from collections.abc import Callable
from typing import Any

from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

__all__ = [
    "create_windows_profile_key",
    "encrypt_chromium_value",
]

_CBC_IV = b" " * 16
_GCM_NONCE_BYTES = 12


def encrypt_chromium_value(
    plaintext: str | bytes,
    *,
    key: bytes,
    platform: str,
    prefix: str | None = None,
) -> bytes:
    """Encrypt ``plaintext`` as a Chromium ``v10``/``v11`` value.

    Raises:
        TypeError: When ``key`` is not bytes.
        ValueError: On a platform without an OSCrypt format.
    """

    if not isinstance(key, (bytes, bytearray)):
        msg = "a target encryption key is required"
        raise TypeError(msg)
    data = (
        bytes(plaintext)
        if isinstance(plaintext, (bytes, bytearray))
        else str(plaintext).encode("utf-8")
    )
    tag = (prefix or "v10").encode("ascii")
    if platform == "win32":
        nonce = os.urandom(_GCM_NONCE_BYTES)
        # AESGCM appends the 16-byte tag, matching Chromium's layout.
        return tag + nonce + AESGCM(bytes(key)).encrypt(nonce, data, None)
    if platform in ("darwin", "linux"):
        padder = padding.PKCS7(128).padder()
        padded = padder.update(data) + padder.finalize()
        encryptor = Cipher(algorithms.AES(bytes(key)), modes.CBC(_CBC_IV)).encryptor()
        return tag + encryptor.update(padded) + encryptor.finalize()
    msg = f"Chromium value encryption is unsupported on {platform}"
    raise ValueError(msg)


def create_windows_profile_key(
    *,
    encrypt_dpapi: Callable[[bytes], Any] | None = None,
    generate_key: Callable[[], bytes] = lambda: os.urandom(32),
) -> dict[str, Any]:
    """Create a Windows OSCrypt key for a fresh profile.

    Args:
        encrypt_dpapi: Protects the key for the current user (``CryptProtectData``).
        generate_key: Returns the raw 32-byte AES-256-GCM key; for tests.

    Returns:
        ``{"key": bytes, "encryptedKeyBase64": str}``; the latter is the
        ``os_crypt.encrypted_key`` value for the target ``Local State``
        (``"DPAPI"`` + the protected key, base64 encoded).

    Raises:
        TypeError: When ``encrypt_dpapi`` is not callable.
    """

    if not callable(encrypt_dpapi):
        msg = "create_windows_profile_key requires an encrypt_dpapi function"
        raise TypeError(msg)
    key = generate_key()
    tagged = b"DPAPI" + bytes(encrypt_dpapi(key))
    return {"key": key, "encryptedKeyBase64": base64.b64encode(tagged).decode("ascii")}
