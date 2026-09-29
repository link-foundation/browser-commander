"""Recover Firefox's NSS login key from ``key4.db`` and decrypt login fields.

Firefox encrypts ``logins.json`` fields with 3DES-CBC under a key stored in
the NSS soft token ``key4.db``. That key is itself wrapped with a key derived
from the primary password (empty by default):

* modern profiles use PBES2: PBKDF2-HMAC-SHA256 over ``SHA1(globalSalt +
  password)`` and AES-256-CBC;
* old profiles use PKCS#12 ``pbeWithSha1AndTripleDES-CBC``.

The ``password-check`` entry in the ``metadata`` table proves the password
before the private key is unwrapped, so a set primary password is reported as
:class:`PrimaryPasswordError` instead of producing garbage.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import importlib
import sqlite3
from typing import Any

from cryptography.hazmat.primitives import hashes, padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from browser_commander.browser.migration.firefox_der import (
    DER_TAG,
    DerElement,
    decode_der_element,
    decode_der_sequence,
    oid_to_string,
)
from browser_commander.browser.migration.fs_utils import PathLike
from browser_commander.browser.migration.sqlite_snapshot import (
    read_database_snapshot,
)

__all__ = [
    "NSS_OID",
    "PrimaryPasswordError",
    "decrypt_firefox_field",
    "recover_firefox_key",
    "recover_firefox_key_from_database",
]

#: Algorithm identifiers found in NSS blobs.
NSS_OID = {
    "PBES2": "1.2.840.113549.1.5.13",
    "PBKDF2": "1.2.840.113549.1.5.12",
    "DES_EDE3_CBC": "1.2.840.113549.3.7",
    "PBE_SHA1_3DES": "1.2.840.113549.1.12.5.1.3",
}

_PASSWORD_CHECK = b"password-check\x02\x02"


class PrimaryPasswordError(Exception):
    """The profile has a Firefox primary password that was not supplied."""

    def __init__(self, message: str = "Firefox primary password is set") -> None:
        super().__init__(message)


def _children(element: DerElement) -> list[DerElement]:
    if element.children is not None:
        return element.children
    return decode_der_sequence(element.content)


def _integer_value(element: DerElement) -> int:
    return int.from_bytes(element.content, "big") if element.content else 0


def _as_bytes(value: Any) -> bytes:
    if value is None:
        return b""
    if isinstance(value, str):
        return value.encode("utf-8")
    return bytes(value)


def _password_hash(global_salt: bytes, primary_password: bytes) -> bytes:
    # NSS fixes this derivation step: key4.db stores the password as
    # SHA-1(globalSalt + password) and feeds that digest into PBKDF2 (or the
    # PKCS#12 KDF below). It is the on-disk Firefox format we must read, not a
    # password-hashing choice, so a stronger hash would simply not decrypt.
    return hashlib.sha1(global_salt + primary_password).digest()


def _triple_des(key: bytes) -> Any:
    """Return a TripleDES algorithm, wherever this cryptography keeps it."""

    try:
        module = importlib.import_module(
            "cryptography.hazmat.decrepit.ciphers.algorithms"
        )
    except ImportError:  # cryptography < 43
        module = algorithms
    return module.TripleDES(key)


def _decrypt_3des_cbc(key: bytes, iv: bytes, ciphertext: bytes) -> bytes:
    decryptor = Cipher(_triple_des(key), modes.CBC(iv)).decryptor()
    return decryptor.update(ciphertext) + decryptor.finalize()


def _pkcs7_unpad(data: bytes) -> bytes:
    if not data:
        return data
    pad_length = data[-1]
    if 0 < pad_length <= len(data):
        return data[:-pad_length]
    return data


def _decrypt_pbes2(
    algorithm_params: DerElement,
    ciphertext: bytes,
    global_salt: bytes,
    primary_password: bytes,
) -> bytes:
    kdf, encryption_scheme = _children(algorithm_params)[:2]
    pbkdf2_params = _children(kdf)[1]
    params = _children(pbkdf2_params)
    entry_salt = params[0].content
    iterations = _integer_value(params[1])
    key_length = (
        _integer_value(params[2])
        if len(params) > 2 and params[2].tag == DER_TAG["INTEGER"]
        else 32
    )
    iv_element = _children(encryption_scheme)[1]

    key = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=key_length,
        salt=entry_salt,
        iterations=iterations,
    ).derive(_password_hash(global_salt, primary_password))
    iv = b"\x04\x0e" + iv_element.content
    decryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    padded = decryptor.update(ciphertext) + decryptor.finalize()
    unpadder = padding.PKCS7(128).unpadder()
    return unpadder.update(padded) + unpadder.finalize()


def _decrypt_pbe_sha1_triple_des(
    algorithm_params: DerElement,
    ciphertext: bytes,
    global_salt: bytes,
    primary_password: bytes,
) -> bytes:
    entry_salt = _children(algorithm_params)[0].content
    hashed_password = _password_hash(global_salt, primary_password)
    padded_salt = (entry_salt + bytes(max(20 - len(entry_salt), 0)))[:20]
    # The legacy NSS PKCS#12 KDF is SHA-1 based by definition.
    combined = hashlib.sha1(hashed_password + entry_salt).digest()
    k1 = hmac.new(combined, padded_salt + entry_salt, hashlib.sha1).digest()
    tk = hmac.new(combined, padded_salt, hashlib.sha1).digest()
    k2 = hmac.new(combined, tk + entry_salt, hashlib.sha1).digest()
    derived = k1 + k2
    return _pkcs7_unpad(_decrypt_3des_cbc(derived[:24], derived[-8:], ciphertext))


def _decrypt_nss_blob(
    blob: bytes, global_salt: bytes, primary_password: bytes
) -> bytes:
    algorithm_id, cipher_element = _children(decode_der_element(blob))[:2]
    algorithm_children = _children(algorithm_id)
    oid = oid_to_string(algorithm_children[0].content)
    params = algorithm_children[1]
    if oid == NSS_OID["PBES2"]:
        return _decrypt_pbes2(
            params, cipher_element.content, global_salt, primary_password
        )
    if oid == NSS_OID["PBE_SHA1_3DES"]:
        return _decrypt_pbe_sha1_triple_des(
            params, cipher_element.content, global_salt, primary_password
        )
    msg = f"Unsupported NSS key algorithm {oid}"
    raise ValueError(msg)


def recover_firefox_key_from_database(
    database: sqlite3.Connection, primary_password: bytes | str = b""
) -> bytes:
    """Recover the 24-byte 3DES login key from an open ``key4.db``.

    Raises:
        PrimaryPasswordError: When the password check does not decrypt, which
            means a primary password is set (or the wrong one was given).
        ValueError: When the database has no key material.
    """

    password = _as_bytes(primary_password)
    meta = database.execute(
        "SELECT item1, item2 FROM metadata WHERE id = 'password'"
    ).fetchone()
    if meta is None:
        msg = "key4.db has no password metadata"
        raise ValueError(msg)
    global_salt = _as_bytes(meta[0])
    try:
        check = _decrypt_nss_blob(_as_bytes(meta[1]), global_salt, password)
    except Exception:
        raise PrimaryPasswordError()
    if check[: len(_PASSWORD_CHECK)] != _PASSWORD_CHECK:
        raise PrimaryPasswordError()
    private = database.execute("SELECT a11, a102 FROM nssPrivate").fetchone()
    if private is None:
        msg = "key4.db has no nssPrivate key"
        raise ValueError(msg)
    return _decrypt_nss_blob(_as_bytes(private[0]), global_salt, password)[:24]


def decrypt_firefox_field(base64_value: str, key: bytes) -> str:
    """Decrypt one ``encryptedUsername``/``encryptedPassword`` value."""

    top = decode_der_element(base64.b64decode(base64_value))
    algorithm, cipher_element = _children(top)[1:3]
    iv = _children(algorithm)[1].content
    plaintext = _decrypt_3des_cbc(key, iv, cipher_element.content)
    return _pkcs7_unpad(plaintext).decode("utf-8")


def recover_firefox_key(
    key4_path: PathLike, primary_password: bytes | str = b""
) -> bytes:
    """Recover the login key from a ``key4.db`` file via a read-only snapshot."""

    return read_database_snapshot(
        key4_path,
        lambda database: recover_firefox_key_from_database(database, primary_password),
    )
