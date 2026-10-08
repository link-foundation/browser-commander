import path from 'node:path';
import { rm } from 'node:fs/promises';
import { browserFamily } from './browser-sources.js';
import { matchesDomains } from './migration/domains.js';
import {
  resolveBrowserProfile,
  resolveSourceBrowser,
} from './browser-profiles.js';
import { saveStorageState } from './storage-state.js';
import { setCookies } from './session-cookies.js';

/** Decrypt through the source browser in a disposable cookie-only snapshot. */
export async function readBrowserCookieSession(options, dependencies = {}) {
  const browser = await resolveSourceBrowser(options.browser, dependencies);
  if (browserFamily(browser) !== 'chromium') {
    throw new TypeError(
      'Browser-backed cookie reading requires a Chromium snapshot; use via: database for Firefox or Safari'
    );
  }
  const profile = options.profileDir
    ? { path: options.profileDir }
    : await resolveBrowserProfile({
        ...dependencies,
        browser,
        profile: options.profile,
      });
  const launch =
    dependencies.launch ??
    (await import('./real-browser.js')).launchRealBrowser;
  const result = await launch({
    ...options.launchOptions,
    channel: browser,
    engine: options.engine ?? 'playwright',
    attach: {
      mode: 'snapshot',
      browser,
      profile: path.basename(profile.path),
      userDataDir: path.dirname(profile.path),
      include: ['cookies'],
    },
  });
  try {
    const state = await saveStorageState(result.page);
    return state.cookies.filter((cookie) =>
      matchesDomains(
        cookie.domain,
        options.domains ?? (options.domainFilter ? [options.domainFilter] : [])
      )
    );
  } finally {
    await result.close();
  }
}

async function readDatabaseSession(source, options, dependencies) {
  const read =
    dependencies.readCookies ??
    (await import('./browser-cookies.js')).readBrowserCookies;
  const cookies = (
    await read({
      browser: source.browser,
      profileDir: source.path,
      via: 'database',
      cache: false,
    })
  ).filter((cookie) => matchesDomains(cookie.domain, options.domains));
  let loggedIn = null;
  if (options.isLoggedIn) {
    const launch =
      dependencies.launch ?? (await import('./launcher.js')).launchBrowser;
    const engine = source.engine ?? options.engine ?? 'playwright';
    const result = await launch({
      ...options.launchOptions,
      ...source.launchOptions,
      engine,
      launch: 'engine',
      userDataDir: undefined,
      attach: undefined,
      persistSessionCookies: false,
    });
    try {
      await setCookies({ page: result.page, engine, cookies });
      loggedIn = Boolean(
        await options.isLoggedIn({ ...result, source, cookies })
      );
    } finally {
      await result.close();
    }
  }
  return { ...source, cookies, loggedIn };
}

/** Discover candidate profiles and optionally validate their live sign-in state. */
export async function findSiteSessions(options = {}, dependencies = {}) {
  if (!Array.isArray(options.domains) || !options.domains.length) {
    throw new TypeError('findSiteSessions requires domains');
  }
  const list =
    dependencies.listSources ??
    (await import('./browser-cookies.js')).listCookieSources;
  const sources = [
    ...(options.sources ?? (await list({ domains: options.domains }))),
    ...(options.profiles ?? []),
  ];
  const sessions = [];
  for (const source of sources) {
    let result;
    let snapshot;
    try {
      if (browserFamily(source.browser) !== 'chromium') {
        sessions.push(await readDatabaseSession(source, options, dependencies));
        continue;
      }
      const attach = {
        mode: 'snapshot',
        browser: source.browser,
        profile: path.basename(source.path),
        userDataDir: path.dirname(source.path),
        include: ['cookies'],
      };
      if (source.launch === 'engine') {
        const copy =
          dependencies.snapshot ??
          (await import('./attach/snapshot.js')).snapshotUserDataDir;
        snapshot = await copy(attach);
        const launch =
          dependencies.launch ?? (await import('./launcher.js')).launchBrowser;
        result = await launch({
          ...options.launchOptions,
          ...source.launchOptions,
          engine: source.engine ?? options.engine ?? 'playwright',
          launch: 'engine',
          userDataDir: snapshot.target,
          args: [
            ...(options.launchOptions?.args ?? []),
            ...(source.launchOptions?.args ?? []),
            `--profile-directory=${attach.profile}`,
          ],
        });
      } else {
        const launch =
          dependencies.launch ??
          (await import('./real-browser.js')).launchRealBrowser;
        result = await launch({
          ...options.launchOptions,
          engine: source.engine ?? options.engine ?? 'playwright',
          channel: source.browser,
          attach,
        });
      }
      const state = await saveStorageState(result.page);
      const cookies = state.cookies.filter((cookie) =>
        matchesDomains(cookie.domain, options.domains)
      );
      const loggedIn = options.isLoggedIn
        ? Boolean(await options.isLoggedIn({ ...result, source, cookies }))
        : null;
      sessions.push({ ...source, cookies, loggedIn });
    } catch (error) {
      sessions.push({
        ...source,
        cookies: [],
        loggedIn: null,
        error: error.message,
      });
    } finally {
      try {
        await result?.close();
      } catch (error) {
        sessions.at(-1).error = error.message;
      } finally {
        if (snapshot) {
          try {
            await rm(snapshot.target, { recursive: true, force: true });
          } catch (error) {
            sessions.at(-1).error = error.message;
          }
        }
      }
    }
  }
  return sessions;
}
