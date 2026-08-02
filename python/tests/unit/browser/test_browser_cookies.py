"""Regression tests for importing installed-browser cookies."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import stat
from pathlib import Path
from typing import Any

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
from browser_commander.browser import (
    list_browser_profiles as browser_list_browser_profiles,
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
