import { matchesDomains } from './migration/domains.js';
import { restoreWebDriverStorageState } from './storage-state.js';

/** Normalize cookie shape without turning session cookies into expired cookies. */
export function normalizeSessionCookies(cookies, engine) {
  if (!Array.isArray(cookies)) {
    throw new TypeError('cookies must be an array');
  }
  return cookies.map(({ expires, ...cookie }) => ({
    ...cookie,
    ...(cookie.sameSite
      ? {
          sameSite:
            cookie.sameSite[0].toUpperCase() +
            cookie.sameSite.slice(1).toLowerCase(),
        }
      : {}),
    ...(Number.isFinite(expires) && expires > 0
      ? { expires }
      : engine === 'playwright' && expires !== undefined
        ? { expires: -1 }
        : {}),
  }));
}

/** Add cookies to the current context, including cookies for other origins. */
export async function setCookies({ page, engine, cookies } = {}) {
  const normalized = normalizeSessionCookies(cookies, engine);
  if (engine === 'playwright') {
    return page.context().addCookies(normalized);
  }
  if (engine === 'selenium' && !(await page.bidi?.())) {
    return restoreWebDriverStorageState({
      page,
      storageState: { cookies: normalized, origins: [] },
    });
  }
  const context = page.browserContext?.();
  if (typeof context?.setCookie === 'function') {
    return context.setCookie(...normalized);
  }
  if (typeof page.browser?.().setCookie === 'function') {
    return page.browser().setCookie(...normalized);
  }
  return page.setCookie(...normalized);
}

/** Clear the context or only cookies whose domain matches the requested site. */
export async function clearCookies({ page, engine, domain } = {}) {
  if (engine === 'playwright' && !domain) {
    return page.context().clearCookies();
  }
  const context =
    engine === 'playwright' ? page.context() : page.browserContext?.();
  const cookies =
    engine === 'playwright'
      ? await context.cookies()
      : typeof context?.cookies === 'function'
        ? await context.cookies()
        : await page.cookies();
  const selected = cookies.filter(
    (cookie) => !domain || matchesDomains(cookie.domain, [domain])
  );
  if (engine === 'playwright') {
    for (const cookie of selected) {
      await context.clearCookies({
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
      });
    }
  } else if (typeof context?.deleteCookie === 'function') {
    await context.deleteCookie(...selected);
  } else {
    await page.deleteCookie(...selected);
  }
  return selected.length;
}
