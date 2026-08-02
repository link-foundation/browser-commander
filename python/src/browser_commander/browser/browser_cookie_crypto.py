"""Chromium cookie key derivation and decryption primitives."""

from __future__ import annotations

import hashlib
import hmac
import sys

from cryptography.hazmat.primitives import hashes, padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

DOMAIN_HASH_BYTES = 32


def derive_chromium_cookie_key(password: str, platform: str) -> bytes:
    """Derive a Chromium AES-CBC key from its Safe Storage password."""
    if platform not in ("darwin", "linux"):
        raise ValueError(f"CBC cookie keys are not used on {platform}")
    return PBKDF2HMAC(
        algorithm=hashes.SHA1(),
        length=16,
        salt=b"saltysalt",
        iterations=1003 if platform == "darwin" else 1,
    ).derive(password.encode())


def _remove_domain_hash(plaintext: bytes, host: str, database_version: int) -> bytes:
    if database_version < 24:
        return plaintext
    if len(plaintext) < DOMAIN_HASH_BYTES:
        raise ValueError("decrypted cookie is missing its domain hash")
    expected = hashlib.sha256(host.encode()).digest()
    actual = plaintext[:DOMAIN_HASH_BYTES]
    if not hmac.compare_digest(actual, expected):
        raise ValueError("decrypted cookie domain hash does not match its host")
    return plaintext[DOMAIN_HASH_BYTES:]


def _decrypt_cbc(encrypted_value: bytes, key: bytes) -> bytes:
    decryptor = Cipher(algorithms.AES(key), modes.CBC(b" " * 16)).decryptor()
    padded = decryptor.update(encrypted_value[3:]) + decryptor.finalize()
    unpadder = padding.PKCS7(128).unpadder()
    return unpadder.update(padded) + unpadder.finalize()


def _decrypt_gcm(encrypted_value: bytes, key: bytes) -> bytes:
    payload = encrypted_value[3:]
    if len(payload) < 28:
        raise ValueError("encrypted AES-GCM cookie is truncated")
    nonce, ciphertext, tag = payload[:12], payload[12:-16], payload[-16:]
    decryptor = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
    return decryptor.update(ciphertext) + decryptor.finalize()


def decode_chromium_cookie_plaintext(
    plaintext: bytes,
    *,
    host: str,
    database_version: int = 0,
) -> str:
    """Validate and decode plaintext returned by a platform decryptor."""
    return _remove_domain_hash(plaintext, host, database_version).decode("utf-8")


def decrypt_chromium_cookie(
    encrypted_value: bytes,
    *,
    host: str,
    database_version: int = 0,
    platform: str = sys.platform,
    key: bytes,
) -> str:
    """Decrypt a Chromium cookie using an already recovered encryption key."""
    prefix = encrypted_value[:3]
    if prefix == b"v20":
        raise ValueError(
            "Windows app-bound v20 cookies cannot be decrypted outside the browser; "
            "use a browser-supported export or a previously saved storage state"
        )
    if prefix not in (b"v10", b"v11"):
        raise ValueError("cookie has an unsupported Chromium encryption prefix")
    plaintext = (
        _decrypt_gcm(encrypted_value, key)
        if platform == "win32"
        else _decrypt_cbc(encrypted_value, key)
    )
    return decode_chromium_cookie_plaintext(
        plaintext,
        host=host,
        database_version=database_version,
    )


def chromium_same_site(value: int) -> str:
    """Map Chromium's integer SameSite value to the automation API value."""
    if value == 2:
        return "Strict"
    if value == 1:
        return "Lax"
    return "None"


def firefox_same_site(value: int) -> str:
    """Map Firefox's integer SameSite value to the automation API value."""
    if value == 2:
        return "Strict"
    if value == 1:
        return "Lax"
    return "None"
