"""Owner-only cookie result and derived-key cache with process locking."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import threading
import time
import uuid
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

DEFAULT_TTL_MINUTES = 60.0
LOCK_STALE_SECONDS = 30.0
LOCK_WAIT_SECONDS = 30.0
_credential_memory_cache: dict[str, tuple[bytes, float]] = {}
_memory_lock = threading.Lock()


@dataclass(frozen=True)
class NormalizedCookieCache:
    """Internal normalized cache configuration."""

    enabled: bool
    directory: Path | None = None
    ttl_seconds: float = 0


def clear_browser_cookie_memory_cache() -> None:
    """Clear only the in-process key cache; intended for isolation and tests."""
    with _memory_lock:
        _credential_memory_cache.clear()


def normalize_cookie_cache(
    cache: object, home_dir: Path, ttl_minutes: float | None
) -> NormalizedCookieCache:
    """Normalize the public cache object without importing its dataclass."""
    selected_ttl = (
        ttl_minutes
        if ttl_minutes is not None
        else getattr(cache, "ttl_minutes", DEFAULT_TTL_MINUTES)
    )
    if not isinstance(selected_ttl, (int, float)) or selected_ttl < 0:
        raise ValueError("cookie cache ttl_minutes must be a non-negative number")
    if cache is False:
        return NormalizedCookieCache(
            enabled=False,
            ttl_seconds=float(selected_ttl) * 60,
        )
    configured_dir = getattr(cache, "dir", None)
    directory = (
        Path(configured_dir).expanduser().resolve()
        if configured_dir is not None
        else home_dir / ".browser-commander" / "cookie-cache"
    )
    return NormalizedCookieCache(
        enabled=True,
        directory=directory,
        ttl_seconds=float(selected_ttl) * 60,
    )


def _hash(identity: str) -> str:
    return hashlib.sha256(identity.encode()).hexdigest()


def _cache_path(cache: NormalizedCookieCache, kind: str, identity: str) -> Path:
    assert cache.directory is not None
    return cache.directory / f"{kind}-{_hash(identity)}.json"


def _ensure_cache_directory(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with suppress(OSError):
        directory.chmod(0o700)


def _read_fresh_json(
    path: Path, ttl_seconds: float, now: Callable[[], float]
) -> dict | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        age = now() - float(value["savedAt"])
        return value if 0 <= age <= ttl_seconds else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _write_owner_only_json(path: Path, value: dict) -> None:
    temporary_path = path.with_name(f"{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    descriptor = os.open(temporary_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        temporary_path.replace(path)
        with suppress(OSError):
            path.chmod(0o600)
    finally:
        with suppress(FileNotFoundError):
            temporary_path.unlink()


def read_cookie_result_cache(
    cache: NormalizedCookieCache,
    identity: str,
    *,
    refresh: bool,
    now: Callable[[], float] = time.time,
) -> list[dict] | None:
    """Read a fresh decrypted-cookie result, unless refresh was requested."""
    if not cache.enabled or refresh:
        return None
    cached = _read_fresh_json(
        _cache_path(cache, "cookies", identity), cache.ttl_seconds, now
    )
    if (
        cached
        and cached.get("kind") == "cookies"
        and isinstance(cached.get("cookies"), list)
    ):
        return cached["cookies"]
    return None


def write_cookie_result_cache(
    cache: NormalizedCookieCache,
    identity: str,
    cookies: list[dict],
    *,
    now: Callable[[], float] = time.time,
) -> None:
    """Store a decrypted-cookie result in an owner-only file."""
    if not cache.enabled:
        return
    assert cache.directory is not None
    _ensure_cache_directory(cache.directory)
    _write_owner_only_json(
        _cache_path(cache, "cookies", identity),
        {"version": 1, "kind": "cookies", "savedAt": now(), "cookies": cookies},
    )


def _remove_stale_lock(lock_path: Path, now: Callable[[], float]) -> None:
    try:
        if now() - lock_path.stat().st_mtime > LOCK_STALE_SECONDS:
            lock_path.unlink()
    except OSError:
        pass


def _acquire_lock_or_cached(
    lock_path: Path,
    cached_path: Path,
    *,
    initial_saved_at: object,
    refresh: bool,
    ttl_seconds: float,
    now: Callable[[], float],
) -> tuple[int | None, dict | None]:
    started_at = now()
    while now() - started_at <= LOCK_WAIT_SECONDS:
        try:
            descriptor = os.open(lock_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            return descriptor, None
        except FileExistsError:
            cached = _read_fresh_json(cached_path, ttl_seconds, now)
            if (
                cached
                and cached.get("kind") == "derived-key"
                and (not refresh or cached.get("savedAt") != initial_saved_at)
            ):
                return None, cached
            _remove_stale_lock(lock_path, now)
            time.sleep(0.05)
    raise TimeoutError("timed out waiting for another cookie credential reader")


def _load_or_create_credential(
    cache: NormalizedCookieCache,
    identity: str,
    create: Callable[[], bytes],
    *,
    refresh: bool,
    metadata: dict,
    now: Callable[[], float],
) -> tuple[bytes, float]:
    if not cache.enabled:
        return bytes(create()), now()
    assert cache.directory is not None
    _ensure_cache_directory(cache.directory)
    cached_path = _cache_path(cache, "credential", identity)
    lock_path = cached_path.with_suffix(".json.lock")
    initial = _read_fresh_json(cached_path, cache.ttl_seconds, now)
    if not refresh and initial and initial.get("kind") == "derived-key":
        return base64.b64decode(initial["key"]), float(initial["savedAt"])

    descriptor, waited_cache = _acquire_lock_or_cached(
        lock_path,
        cached_path,
        initial_saved_at=initial.get("savedAt") if initial else None,
        refresh=refresh,
        ttl_seconds=cache.ttl_seconds,
        now=now,
    )
    if waited_cache:
        return (
            base64.b64decode(waited_cache["key"]),
            float(waited_cache["savedAt"]),
        )

    assert descriptor is not None
    os.close(descriptor)
    try:
        after_lock = _read_fresh_json(cached_path, cache.ttl_seconds, now)
        if (
            after_lock
            and after_lock.get("kind") == "derived-key"
            and (
                not refresh
                or after_lock.get("savedAt")
                != (initial.get("savedAt") if initial else None)
            )
        ):
            return (
                base64.b64decode(after_lock["key"]),
                float(after_lock["savedAt"]),
            )
        key = bytes(create())
        saved_at = now()
        _write_owner_only_json(
            cached_path,
            {
                "version": 1,
                "kind": "derived-key",
                "savedAt": saved_at,
                "key": base64.b64encode(key).decode(),
                **metadata,
            },
        )
        return key, saved_at
    finally:
        with suppress(FileNotFoundError):
            lock_path.unlink()


def get_cached_credential(
    cache: NormalizedCookieCache,
    identity: str,
    create: Callable[[], bytes],
    *,
    refresh: bool,
    metadata: dict,
    now: Callable[[], float] = time.time,
) -> bytes:
    """Read or create a derived key with in-process and cross-process reuse."""
    memory_identity = f"{cache.directory}:{identity}"
    if not refresh:
        with _memory_lock:
            cached = _credential_memory_cache.get(memory_identity)
        if cached is not None:
            key, saved_at = cached
            age = now() - saved_at
            if 0 <= age <= cache.ttl_seconds:
                return key
            with _memory_lock:
                _credential_memory_cache.pop(memory_identity, None)
    key, saved_at = _load_or_create_credential(
        cache,
        identity,
        create,
        refresh=refresh,
        metadata=metadata,
        now=now,
    )
    with _memory_lock:
        _credential_memory_cache[memory_identity] = (key, saved_at)
    return key
