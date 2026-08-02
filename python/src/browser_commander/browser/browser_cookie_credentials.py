"""OS credential-store access used by installed Chromium cookie import."""

from __future__ import annotations

import base64
import ctypes
import json
import os
import subprocess
import sys
from collections.abc import Mapping
from ctypes import wintypes
from pathlib import Path

SAFE_STORAGE = {
    "brave": {
        "application": "brave",
        "folder": "Brave Keys",
        "service": "Brave Safe Storage",
    },
    "chrome": {
        "application": "chrome",
        "folder": "Chrome Keys",
        "service": "Chrome Safe Storage",
    },
    "chromium": {
        "application": "chromium",
        "folder": "Chromium Keys",
        "service": "Chromium Safe Storage",
    },
    "edge": {
        "application": "microsoft-edge",
        "folder": "Microsoft Edge Keys",
        "service": "Microsoft Edge Safe Storage",
    },
}


def _run_credential_command(command: list[str], environment: Mapping[str, str]) -> str:
    completed = subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        env=dict(environment),
    )
    return completed.stdout.strip()


def _read_linux_safe_storage_password(
    browser: str, environment: Mapping[str, str]
) -> str:
    identity = SAFE_STORAGE[browser]
    try:
        password = _run_credential_command(
            ["secret-tool", "lookup", "application", identity["application"]],
            environment,
        )
        if password:
            return password
    except (OSError, subprocess.CalledProcessError):
        pass
    try:
        password = _run_credential_command(
            [
                "kwallet-query",
                "-r",
                identity["service"],
                "-f",
                identity["folder"],
                "kdewallet",
            ],
            environment,
        )
        if password:
            return password
    except (OSError, subprocess.CalledProcessError):
        pass
    raise RuntimeError(
        f"Could not read {identity['service']} from libsecret or KWallet; "
        "install secret-tool or unlock the browser key store"
    )


def read_safe_storage_password(
    *,
    browser: str,
    platform: str = sys.platform,
    environment: Mapping[str, str] | None = None,
) -> str:
    """Read a Chromium Safe Storage password from the OS credential store."""
    environment = os.environ if environment is None else environment
    identity = SAFE_STORAGE.get(browser)
    if identity is None:
        raise ValueError(f"No Safe Storage identity is known for {browser}")
    if platform == "darwin":
        password = _run_credential_command(
            [
                "security",
                "find-generic-password",
                "-w",
                "-s",
                identity["service"],
            ],
            environment,
        )
        if not password:
            raise RuntimeError(f"{identity['service']} returned an empty password")
        return password
    if platform == "linux":
        return _read_linux_safe_storage_password(browser, environment)
    raise ValueError(f"Safe Storage passwords are not used on {platform}")


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def decrypt_windows_dpapi(encrypted_value: bytes, **_kwargs: object) -> bytes:
    """Decrypt bytes with Windows DPAPI in the current user's context."""
    if sys.platform != "win32":
        raise RuntimeError("Windows DPAPI is only available on Windows")
    buffer = ctypes.create_string_buffer(encrypted_value)
    input_blob = _DataBlob(
        len(encrypted_value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte))
    )
    output_blob = _DataBlob()
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    if not crypt32.CryptUnprotectData(
        ctypes.byref(input_blob),
        None,
        None,
        None,
        None,
        0,
        ctypes.byref(output_blob),
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(output_blob.pbData, output_blob.cbData)
    finally:
        kernel32.LocalFree(output_blob.pbData)


def read_windows_encryption_key(
    *,
    local_state_path: Path,
    environment: Mapping[str, str] | None = None,
    decrypt_dpapi=decrypt_windows_dpapi,
) -> bytes:
    """Recover the legacy AES-GCM key from Chromium Local State."""
    del environment
    try:
        state = json.loads(local_state_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise RuntimeError(f"Could not read Chromium Local State: {error}") from error
    encoded = state.get("os_crypt", {}).get("encrypted_key")
    if not encoded:
        raise RuntimeError("Chromium Local State has no os_crypt.encrypted_key")
    encrypted_key = base64.b64decode(encoded)
    if not encrypted_key.startswith(b"DPAPI"):
        raise RuntimeError("Chromium Local State key has no DPAPI prefix")
    return bytes(decrypt_dpapi(encrypted_key[5:]))
