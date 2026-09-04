/**
 * Apply a fingerprint profile to a live page.
 *
 * Everything goes through CDP, including the init script, so the same code
 * path works for Playwright and Puppeteer and behaves identically in both.
 * The alternative -- `context.addInitScript` on one engine and
 * `page.evaluateOnNewDocument` on the other -- would give the two engines
 * subtly different injection timing, which is exactly the kind of difference
 * this module exists to remove.
 */
import { buildCdpEmulationCommands } from './cdp-overrides.js';
import { buildFingerprintInitScript } from './init-script.js';
import { resolveFingerprintProfile } from './profile.js';

/** Open a CDP session for a page, whichever engine owns it. */
export function createCdpSession({ browser, page, engine }) {
  if (engine === 'puppeteer') {
    if (typeof page.createCDPSession === 'function') {
      return page.createCDPSession();
    }
    return page.target().createCDPSession();
  }
  // Playwright exposes newCDPSession on the browser context; a persistent
  // context is what `launchBrowser` hands back as `browser`.
  const context =
    typeof browser?.newCDPSession === 'function' ? browser : page.context();
  return context.newCDPSession(page);
}

async function applyToPage({ browser, page, engine, commands, initScript }) {
  const session = await createCdpSession({ browser, page, engine });
  for (const { method, params } of commands) {
    await session.send(method, params);
  }
  if (initScript) {
    // Measured: without Page.enable on this session, Chrome accepts
    // addScriptToEvaluateOnNewDocument and returns an identifier, but never
    // runs the script on any subsequent document. Enabling the domain is what
    // makes the instrumentation take effect.
    await session.send('Page.enable');
    await session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: initScript,
    });
    // A page that has already navigated will not replay the init script, so
    // patch the current document too. The payload guards against running
    // twice, which makes this safe on a brand new about:blank as well.
    await session.send('Runtime.evaluate', {
      expression: initScript,
      returnByValue: true,
    });
  }
  return session;
}

/**
 * Apply a fingerprint profile to a page and, optionally, to pages opened later.
 *
 * @param {object} options
 * @param {object} options.browser Playwright context or Puppeteer browser.
 * @param {object} options.page Page to apply the profile to.
 * @param {string} [options.engine] `'playwright'` or `'puppeteer'`.
 * @param {object} options.profile Raw or already-normalized profile.
 * @param {boolean} [options.patchWebdriver] Force `navigator.webdriver` to
 *   `false` from JavaScript. Only needed when attaching to a browser that was
 *   launched with automation switches that can no longer be changed; a browser
 *   launched by this library does not need it, because
 *   `--disable-blink-features=AutomationControlled` already covers it.
 * @param {boolean} [options.applyToNewPages] Also apply to pages opened later.
 * @returns {Promise<object>} The resolved profile, the commands that were sent
 *   and the init script that was injected.
 */
export async function applyFingerprint({
  browser,
  page,
  engine = 'playwright',
  profile,
  patchWebdriver = false,
  applyToNewPages = true,
}) {
  if (!page) {
    throw new TypeError('applyFingerprint requires a page');
  }
  const resolved = Object.isFrozen(profile)
    ? profile
    : resolveFingerprintProfile(profile);
  const commands = buildCdpEmulationCommands(resolved);
  const initScript = buildFingerprintInitScript(resolved, { patchWebdriver });

  await applyToPage({ browser, page, engine, commands, initScript });

  if (applyToNewPages && browser) {
    const attach = (newPage) =>
      applyToPage({
        browser,
        page: newPage,
        engine,
        commands,
        initScript,
      }).catch(() => {
        // A page can close before the session is established; losing the
        // overrides on a page that no longer exists is not an error.
      });
    if (engine === 'puppeteer' && typeof browser.on === 'function') {
      browser.on('targetcreated', async (target) => {
        const newPage = await target.page();
        if (newPage) {
          await attach(newPage);
        }
      });
    } else if (typeof browser.on === 'function') {
      browser.on('page', attach);
    }
  }

  return { profile: resolved, commands, initScript };
}
