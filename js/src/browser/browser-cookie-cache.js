import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_TTL_MINUTES = 60;
const LOCK_STALE_MILLISECONDS = 30_000;
const LOCK_WAIT_MILLISECONDS = 30_000;
const credentialPromises = new Map();

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function clearBrowserCookieMemoryCache() {
  credentialPromises.clear();
}

export function normalizeCookieCache(cache, homeDir, ttlMinutes) {
  const selectedTtl = ttlMinutes ?? cache?.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  if (!Number.isFinite(selectedTtl) || selectedTtl < 0) {
    throw new RangeError(
      'cookie cache ttlMinutes must be a non-negative number'
    );
  }
  if (cache === false) {
    return { enabled: false, ttlSeconds: selectedTtl * 60 };
  }
  return {
    enabled: true,
    dir: path.resolve(
      cache?.dir ?? path.join(homeDir, '.browser-commander', 'cookie-cache')
    ),
    ttlSeconds: selectedTtl * 60,
  };
}

async function ensureCacheDirectory(cacheDir) {
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  await chmod(cacheDir, 0o700).catch(() => {});
}

async function readFreshJson(filePath, ttlSeconds, now) {
  try {
    const value = JSON.parse(await readFile(filePath, 'utf8'));
    const age = now() / 1000 - value.savedAt;
    return age >= 0 && age <= ttlSeconds ? value : null;
  } catch {
    return null;
  }
}

async function writeOwnerOnlyJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  await chmod(filePath, 0o600).catch(() => {});
}

function cachePath(cacheDir, kind, identity) {
  return path.join(cacheDir, `${kind}-${hash(identity)}.json`);
}

export async function readCookieResultCache({
  cache,
  identity,
  refresh,
  now = Date.now,
}) {
  if (!cache.enabled || refresh) {
    return null;
  }
  const cached = await readFreshJson(
    cachePath(cache.dir, 'cookies', identity),
    cache.ttlSeconds,
    now
  );
  return cached?.kind === 'cookies' && Array.isArray(cached.cookies)
    ? cached.cookies
    : null;
}

export async function writeCookieResultCache({
  cache,
  identity,
  cookies,
  now = Date.now,
}) {
  if (!cache.enabled) {
    return;
  }
  await ensureCacheDirectory(cache.dir);
  await writeOwnerOnlyJson(cachePath(cache.dir, 'cookies', identity), {
    version: 1,
    kind: 'cookies',
    savedAt: now() / 1000,
    cookies,
  });
}

async function removeStaleLock(lockPath, now) {
  try {
    const lockStat = await stat(lockPath);
    if (now() - lockStat.mtimeMs > LOCK_STALE_MILLISECONDS) {
      await rm(lockPath, { force: true });
    }
  } catch {
    // Another process may have released it already.
  }
}

async function wait(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireCredentialLock(lockPath, cachedPath, options) {
  const startedAt = options.now();
  while (options.now() - startedAt <= LOCK_WAIT_MILLISECONDS) {
    try {
      return await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      const cached = await readFreshJson(
        cachedPath,
        options.ttlSeconds,
        options.now
      );
      if (
        cached?.kind === 'derived-key' &&
        (!options.refresh || cached.savedAt !== options.initialSavedAt)
      ) {
        return { cached };
      }
      await removeStaleLock(lockPath, options.now);
      await wait(50);
    }
  }
  throw new Error('timed out waiting for another cookie credential reader');
}

async function loadOrCreateCredential({
  cache,
  identity,
  refresh,
  create,
  now,
  metadata,
}) {
  if (!cache.enabled) {
    return { key: Buffer.from(await create()), savedAt: now() / 1000 };
  }
  await ensureCacheDirectory(cache.dir);
  const cachedPath = cachePath(cache.dir, 'credential', identity);
  const lockPath = `${cachedPath}.lock`;
  const initial = await readFreshJson(cachedPath, cache.ttlSeconds, now);
  if (!refresh && initial?.kind === 'derived-key') {
    return {
      key: Buffer.from(initial.key, 'base64'),
      savedAt: initial.savedAt,
    };
  }

  const acquired = await acquireCredentialLock(lockPath, cachedPath, {
    initialSavedAt: initial?.savedAt,
    now,
    refresh,
    ttlSeconds: cache.ttlSeconds,
  });
  if (acquired.cached) {
    return {
      key: Buffer.from(acquired.cached.key, 'base64'),
      savedAt: acquired.cached.savedAt,
    };
  }

  try {
    const afterLock = await readFreshJson(cachedPath, cache.ttlSeconds, now);
    if (
      afterLock?.kind === 'derived-key' &&
      (!refresh || afterLock.savedAt !== initial?.savedAt)
    ) {
      return {
        key: Buffer.from(afterLock.key, 'base64'),
        savedAt: afterLock.savedAt,
      };
    }
    const key = Buffer.from(await create());
    const savedAt = now() / 1000;
    await writeOwnerOnlyJson(cachedPath, {
      version: 1,
      kind: 'derived-key',
      savedAt,
      key: key.toString('base64'),
      ...metadata,
    });
    return { key, savedAt };
  } finally {
    await acquired.close();
    await rm(lockPath, { force: true });
  }
}

export async function getCachedCredential(options) {
  const memoryIdentity = `${options.cache.dir ?? 'disabled'}:${options.identity}`;
  const now = options.now ?? Date.now;
  if (!options.refresh && credentialPromises.has(memoryIdentity)) {
    const cached = await credentialPromises.get(memoryIdentity);
    const age = now() / 1000 - cached.savedAt;
    if (age >= 0 && age <= options.cache.ttlSeconds) {
      return cached.key;
    }
    credentialPromises.delete(memoryIdentity);
  }
  const promise = loadOrCreateCredential({ ...options, now });
  credentialPromises.set(memoryIdentity, promise);
  try {
    return (await promise).key;
  } catch (error) {
    if (credentialPromises.get(memoryIdentity) === promise) {
      credentialPromises.delete(memoryIdentity);
    }
    throw error;
  }
}
