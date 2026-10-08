import path from 'node:path';
import { access } from 'node:fs/promises';
import { assertDedicatedUserDataDir } from './system-browser.js';
import {
  saveStorageState,
  writeRestrictedState,
  loadStorageState,
  restorePlaywrightStorageState,
  restorePuppeteerStorageState,
  restoreWebDriverStorageState,
} from './storage-state.js';

const installed = Symbol('sessionPersistence');
export function sessionPersistencePath(options) {
  if (!options.persistSessionCookies) {
    return null;
  }
  if (!options.userDataDir || options.attach) {
    throw new TypeError(
      'persistSessionCookies requires an explicit dedicated userDataDir'
    );
  }
  assertDedicatedUserDataDir(options.userDataDir);
  return typeof options.persistSessionCookies === 'string'
    ? options.persistSessionCookies
    : path.join(options.userDataDir, 'browser-commander-session.json');
}
export async function installSessionPersistence(result, options) {
  const file = sessionPersistencePath(options);
  if (!file || result[installed]) {
    return result;
  }
  const engine = options.engine ?? 'playwright';
  if (
    await access(file).then(
      () => true,
      () => false
    )
  ) {
    const storageState = await loadStorageState(file);
    if (engine === 'playwright') {
      await restorePlaywrightStorageState({
        context: result.page.context(),
        storageState,
      });
    } else if (engine === 'puppeteer') {
      await restorePuppeteerStorageState({ page: result.page, storageState });
    } else {
      await restoreWebDriverStorageState({ page: result.page, storageState });
    }
  }
  const close = result.close;
  let closing;
  const persistAndClose = () =>
    (closing ??= (async () => {
      try {
        const state = await saveStorageState(result.page);
        await writeRestrictedState(file, {
          cookies: state.cookies.filter((cookie) => !(cookie.expires > 0)),
          origins: [],
        });
      } finally {
        await close();
      }
    })());
  result.close = persistAndClose;
  if (typeof result.browser?.close === 'function') {
    result.browser.close = persistAndClose;
  }
  result[installed] = true;
  return result;
}
