"""Regression tests for importing installed-browser cookies."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import stat
import subprocess
from pathlib import Path
from typing import Any

import pytest
from cryptography.hazmat.primitives import hashes, padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from browser_commander import (
    BrowserCookieCacheOptions,
    BrowserCookieReadOptions,
)
from browser_commander import (
    list_browser_profiles as public_list_browser_profiles,
)
from browser_commander import (
    read_browser_cookies as public_read_browser_cookies,
)
from browser_commander.browser import browser_cookie_credentials as cookie_credentials
from browser_commander.browser import (
    list_browser_profiles as browser_list_browser_profiles,
)
from browser_commander.browser.browser_cookie_cache import (
    NormalizedCookieCache,
    get_cached_credential,
)
from browser_commander.browser.browser_cookie_crypto import (
    decode_chromium_cookie_plaintext,
)
from browser_commander.browser.browser_cookies import (
    BrowserProfile,
    clear_browser_cookie_memory_cache,
    decrypt_chromium_cookie,
    list_browser_profiles,
    read_browser_cookies,
    read_browser_cookies_with_dependencies,
)

CHROME_EPOCH_OFFSET_SECONDS = 11_644_473_600


def _derive_key(password: str, *, iterations: int = 1) -> bytes:
    return PBKDF2HMAC(
        algorithm=hashes.SHA1(),
        length=16,
        salt=b"saltysalt",
        iterations=iterations,
    ).derive(password.encode())


def _encrypt_cbc_cookie(host: str, value: str, password: str) -> bytes:
    plaintext = hashlib.sha256(host.encode()).digest() + value.encode()
    padder = padding.PKCS7(128).padder()
    padded = padder.update(plaintext) + padder.finalize()
    encryptor = Cipher(
        algorithms.AES(_derive_key(password)), modes.CBC(b" " * 16)
    ).encryptor()
    return b"v11" + encryptor.update(padded) + encryptor.finalize()


def _encrypt_gcm_cookie(host: str, value: str, key: bytes) -> bytes:
    nonce = b"fixture12345"
    encryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    plaintext = hashlib.sha256(host.encode()).digest() + value.encode()
    ciphertext = encryptor.update(plaintext) + encryptor.finalize()
    return b"v10" + nonce + ciphertext + encryptor.tag


def _create_chromium_profile(
    home_dir: Path, rows: list[dict[str, Any]], profile: str = "Default"
) -> Path:
    root = home_dir / ".config" / "google-chrome"
    profile_path = root / profile
    cookie_path = profile_path / "Network" / "Cookies"
    cookie_path.parent.mkdir(parents=True)
    (root / "Local State").write_text(
        json.dumps(
            {
                "profile": {
                    "last_used": profile,
                    "info_cache": {profile: {"name": "Primary profile"}},
                }
            }
        ),
        encoding="utf-8",
    )
    with sqlite3.connect(cookie_path) as database:
        database.executescript(
            """
            CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
            INSERT INTO meta (key, value) VALUES ('version', '24');
            CREATE TABLE cookies (
                host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB,
                path TEXT, expires_utc INTEGER, is_secure INTEGER,
                is_httponly INTEGER, samesite INTEGER
            );
            """
        )
        database.executemany(
            """
            INSERT INTO cookies (
                host_key, name, value, encrypted_value, path, expires_utc,
                is_secure, is_httponly, samesite
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    row["host"],
                    row["name"],
                    row.get("value", ""),
                    row.get("encrypted_value", b""),
                    row.get("path", "/"),
                    row.get("expires_utc", 0),
                    int(row.get("secure", False)),
                    int(row.get("http_only", False)),
                    row.get("same_site", -1),
                )
                for row in rows
            ],
        )
    return profile_path


def _create_firefox_profile(home_dir: Path) -> Path:
    root = home_dir / ".mozilla" / "firefox"
    profile_path = root / "fixture.default-release"
    profile_path.mkdir(parents=True)
    (root / "profiles.ini").write_text(
        "[Profile0]\nName=default-release\nIsRelative=1\n"
        "Path=fixture.default-release\nDefault=1\n",
        encoding="utf-8",
    )
    with sqlite3.connect(profile_path / "cookies.sqlite") as database:
        database.executescript(
            """
            CREATE TABLE moz_cookies (
                name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER,
                isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER
            );
            INSERT INTO moz_cookies VALUES (
                'firefox-session', 'plain-value', '.example.org', '/',
                2000000001, 1, 0, 1
            );
            """
        )
    return profile_path


def test_cookie_helpers_are_exported() -> None:
    assert public_list_browser_profiles is list_browser_profiles
    assert browser_list_browser_profiles is list_browser_profiles
    assert public_read_browser_cookies is read_browser_cookies


def test_discovers_chromium_and_firefox_profiles(tmp_path: Path) -> None:
    chromium_path = _create_chromium_profile(tmp_path, [])
    firefox_path = _create_firefox_profile(tmp_path)

    assert list_browser_profiles(
        platform="linux", home_dir=tmp_path, environment={}
    ) == [
        BrowserProfile(
            browser="chrome",
            name="Default",
            display_name="Primary profile",
            path=chromium_path,
            is_default=True,
        ),
        BrowserProfile(
            browser="firefox",
            name="default-release",
            display_name="default-release",
            path=firefox_path,
            is_default=True,
        ),
    ]


def test_decrypts_chromium_and_returns_engine_cookie_shape(tmp_path: Path) -> None:
    password = "fixture safe storage password"
    host = ".example.com"
    _create_chromium_profile(
        tmp_path,
        [
            {
                "host": host,
                "name": "SID",
                "encrypted_value": _encrypt_cbc_cookie(
                    host, "decrypted-session", password
                ),
                "expires_utc": (2_000_000_000 + CHROME_EPOCH_OFFSET_SECONDS)
                * 1_000_000,
                "secure": True,
                "http_only": True,
                "same_site": 2,
            },
            {"host": ".other.test", "name": "ignored", "value": "plain"},
        ],
    )
    credential_reads = 0

    def read_password(**_kwargs: object) -> str:
        nonlocal credential_reads
        credential_reads += 1
        return password

    cookies = read_browser_cookies_with_dependencies(
        BrowserCookieReadOptions(
            browser="chrome",
            domain_filter="example.com",
            cache=BrowserCookieCacheOptions(dir=tmp_path / "cache", ttl_minutes=60),
        ),
        platform="linux",
        home_dir=tmp_path,
        environment={},
        read_safe_storage_password=read_password,
    )

    assert cookies == [
        {
            "name": "SID",
            "value": "decrypted-session",
            "domain": host,
            "path": "/",
            "expires": 2_000_000_000,
            "httpOnly": True,
            "secure": True,
            "sameSite": "Strict",
        }
    ]
    assert credential_reads == 1


def test_reads_firefox_without_credentials(tmp_path: Path) -> None:
    _create_firefox_profile(tmp_path)

    def fail_credential_read(**_kwargs: object) -> str:
        raise AssertionError("Firefox must not read an OS credential")

    cookies = read_browser_cookies_with_dependencies(
        BrowserCookieReadOptions(browser="firefox"),
        platform="linux",
        home_dir=tmp_path,
        environment={},
        read_safe_storage_password=fail_credential_read,
    )

    assert cookies == [
        {
            "name": "firefox-session",
            "value": "plain-value",
            "domain": ".example.org",
            "path": "/",
            "expires": 2_000_000_001,
            "httpOnly": False,
            "secure": True,
            "sameSite": "Lax",
        }
    ]


def test_reuses_owner_only_credential_cache(tmp_path: Path) -> None:
    password = "cached safe storage password"
    hosts = [".example.com", ".example.org"]
    _create_chromium_profile(
        tmp_path,
        [
            {
                "host": host,
                "name": f"session-{index}",
                "encrypted_value": _encrypt_cbc_cookie(
                    host, f"value-{index}", password
                ),
            }
            for index, host in enumerate(hosts)
        ],
    )
    cache_dir = tmp_path / "cache"
    credential_reads = 0

    def read_password(**_kwargs: object) -> str:
        nonlocal credential_reads
        credential_reads += 1
        return password

    for host in hosts:
        read_browser_cookies_with_dependencies(
            BrowserCookieReadOptions(
                browser="chrome",
                domain_filter=host,
                cache=BrowserCookieCacheOptions(dir=cache_dir, ttl_minutes=60),
            ),
            platform="linux",
            home_dir=tmp_path,
            environment={},
            read_safe_storage_password=read_password,
        )
        clear_browser_cookie_memory_cache()

    assert credential_reads == 1
    credential_file = next(cache_dir.glob("credential-*.json"))
    if os.name == "nt":
        acl = subprocess.run(
            ["icacls", str(credential_file)],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        principal = subprocess.run(
            ["whoami"], check=True, capture_output=True, text=True
        ).stdout.strip()
        assert principal.casefold() in acl.casefold()
        assert "(I)" not in acl
    else:
        assert stat.S_IMODE(credential_file.stat().st_mode) == 0o600
    cached = json.loads(credential_file.read_text(encoding="utf-8"))
    assert cached["kind"] == "derived-key"
    assert cached["key"] != password
    assert password not in credential_file.read_text(encoding="utf-8")


def test_windows_gcm_and_app_bound_boundary() -> None:
    key = bytes(range(32))
    host = ".example.net"
    encrypted = _encrypt_gcm_cookie(host, "windows-session", key)

    assert (
        decrypt_chromium_cookie(
            encrypted,
            host=host,
            database_version=24,
            platform="win32",
            key=key,
        )
        == "windows-session"
    )

    try:
        decrypt_chromium_cookie(
            b"v20app-bound-cookie",
            host=host,
            database_version=24,
            platform="win32",
            key=key,
        )
    except ValueError as error:
        assert "app-bound" in str(error)
        assert "outside the browser" in str(error)
    else:
        raise AssertionError("v20 data must fail with an explicit compatibility error")


def test_in_process_credential_cache_expires_after_ttl(tmp_path: Path) -> None:
    current_time = 1_700_000_000.0
    credential_reads = 0

    def now() -> float:
        return current_time

    def create() -> bytes:
        nonlocal credential_reads
        credential_reads += 1
        return bytes([credential_reads]) * 16

    cache = NormalizedCookieCache(
        enabled=False,
        directory=tmp_path,
        ttl_seconds=60,
    )
    assert (
        get_cached_credential(
            cache,
            "chrome:linux:ttl-test",
            create,
            refresh=False,
            metadata={},
            now=now,
        )[0]
        == 1
    )
    current_time += 61
    assert (
        get_cached_credential(
            cache,
            "chrome:linux:ttl-test",
            create,
            refresh=False,
            metadata={},
            now=now,
        )[0]
        == 2
    )
    assert credential_reads == 2


def test_legacy_dpapi_plaintext_validates_version_24_host_hash() -> None:
    host = ".legacy.example"
    plaintext = hashlib.sha256(host.encode()).digest() + b"legacy-session"

    assert (
        decode_chromium_cookie_plaintext(
            plaintext,
            host=host,
            database_version=24,
        )
        == "legacy-session"
    )
    try:
        decode_chromium_cookie_plaintext(
            plaintext,
            host=".wrong.example",
            database_version=24,
        )
    except ValueError as error:
        assert "domain hash does not match" in str(error)
    else:
        raise AssertionError("a mismatched legacy DPAPI host hash must fail")


def test_linux_kwallet_uses_chromium_product_casing(monkeypatch) -> None:
    calls: list[list[str]] = []

    def run(command: list[str], _environment: dict[str, str]) -> str:
        calls.append(command)
        if command[0] == "secret-tool":
            raise FileNotFoundError
        return "kwallet-password"

    monkeypatch.setattr(cookie_credentials, "_run_credential_command", run)
    assert (
        cookie_credentials.read_safe_storage_password(
            browser="chrome",
            platform="linux",
            environment={},
        )
        == "kwallet-password"
    )
    assert calls[1] == [
        "kwallet-query",
        "-r",
        "Chrome Safe Storage",
        "-f",
        "Chrome Keys",
        "kdewallet",
    ]


def test_refresh_reads_credential_once_for_multi_cookie_import(tmp_path: Path) -> None:
    password = "one refresh password"
    host = ".refresh.example"
    _create_chromium_profile(
        tmp_path,
        [
            {
                "host": host,
                "name": name,
                "encrypted_value": _encrypt_cbc_cookie(host, name, password),
            }
            for name in ("first", "second")
        ],
    )
    credential_reads = 0

    def read_password(**_kwargs: object) -> str:
        nonlocal credential_reads
        credential_reads += 1
        return password

    cookies = read_browser_cookies_with_dependencies(
        BrowserCookieReadOptions(browser="chrome", cache=False, refresh=True),
        platform="linux",
        home_dir=tmp_path,
        environment={},
        read_safe_storage_password=read_password,
    )

    assert [(cookie["name"], cookie["value"]) for cookie in cookies] == [
        ("first", "first"),
        ("second", "second"),
    ]
    assert credential_reads == 1


def test_partial_result_cache_is_not_reused_for_strict_import(tmp_path: Path) -> None:
    _create_chromium_profile(
        tmp_path,
        [
            {
                "host": ".strict.example",
                "name": "broken",
                "encrypted_value": b"v10invalid-cbc",
            }
        ],
    )
    cache = BrowserCookieCacheOptions(dir=tmp_path / "cache", ttl_minutes=60)
    dependencies = {
        "platform": "linux",
        "home_dir": tmp_path,
        "environment": {},
    }

    assert (
        read_browser_cookies_with_dependencies(
            BrowserCookieReadOptions(
                browser="chrome",
                cache=cache,
                ignore_decryption_errors=True,
            ),
            **dependencies,
        )
        == []
    )
    with pytest.raises(RuntimeError, match="Could not decrypt cookie broken"):
        read_browser_cookies_with_dependencies(
            BrowserCookieReadOptions(browser="chrome", cache=cache),
            **dependencies,
        )
