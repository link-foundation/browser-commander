/**
 * Translations between the Puppeteer-shaped page API the rest of Browser
 * Commander speaks and the WebDriver wire protocol (issue #104).
 *
 * Everything here is a pure function of its arguments, so the facade in
 * `webdriver-page.js` stays about sequencing commands and these stay testable
 * without a browser.
 */

/**
 * W3C WebDriver key codes for the named keys the Playwright and Puppeteer
 * keyboards accept (WebDriver specification, "Keyboard actions", table of
 * normalized key values). A single character is sent as itself.
 */
export const WEBDRIVER_KEYS = Object.freeze({
  Cancel: '\uE001',
  Help: '\uE002',
  Backspace: '\uE003',
  Tab: '\uE004',
  Clear: '\uE005',
  Enter: '\uE007',
  Shift: '\uE008',
  ShiftLeft: '\uE008',
  Control: '\uE009',
  ControlLeft: '\uE009',
  Alt: '\uE00A',
  AltLeft: '\uE00A',
  Pause: '\uE00B',
  Escape: '\uE00C',
  Space: '\uE00D',
  PageUp: '\uE00E',
  PageDown: '\uE00F',
  End: '\uE010',
  Home: '\uE011',
  ArrowLeft: '\uE012',
  ArrowUp: '\uE013',
  ArrowRight: '\uE014',
  ArrowDown: '\uE015',
  Insert: '\uE016',
  Delete: '\uE017',
  F1: '\uE031',
  F2: '\uE032',
  F3: '\uE033',
  F4: '\uE034',
  F5: '\uE035',
  F6: '\uE036',
  F7: '\uE037',
  F8: '\uE038',
  F9: '\uE039',
  F10: '\uE03A',
  F11: '\uE03B',
  F12: '\uE03C',
  Meta: '\uE03D',
  MetaLeft: '\uE03D',
  Command: '\uE03D',
});

/**
 * Translate one key name into the value a WebDriver key action carries.
 *
 * @param {string} key - A single character or a name such as 'Enter'
 * @returns {string} The WebDriver key value
 */
export function toWebDriverKey(key) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new TypeError(`A key must be a non-empty string, got ${key}`);
  }
  if ([...key].length === 1) {
    return key;
  }
  const value = WEBDRIVER_KEYS[key];
  if (value === undefined) {
    throw new Error(
      `Unknown key "${key}" for WebDriver. Use a single character or one of: ${Object.keys(WEBDRIVER_KEYS).join(', ')}`
    );
  }
  return value;
}

/**
 * Split a Playwright-style chord such as 'Control+A' into the keys held
 * together. A lone '+' is the plus key, not a separator.
 *
 * @param {string} key
 * @returns {string[]} WebDriver key values, modifiers first
 */
export function toWebDriverChord(key) {
  const parts =
    key.length > 1 && key.includes('+')
      ? key.split('+').map((part, index, all) =>
          // 'Control++' holds Control and presses '+'.
          part === '' && index === all.length - 1 ? '+' : part
        )
      : [key];
  return parts.filter((part) => part !== '').map(toWebDriverKey);
}

/** Paper sizes Puppeteer and Playwright accept, in inches (width, height). */
const PAPER_FORMATS_IN = Object.freeze({
  letter: [8.5, 11],
  legal: [8.5, 14],
  tabloid: [11, 17],
  ledger: [17, 11],
  a0: [33.1102, 46.811],
  a1: [23.3858, 33.1102],
  a2: [16.5354, 23.3858],
  a3: [11.6929, 16.5354],
  a4: [8.2677, 11.6929],
  a5: [5.8268, 8.2677],
  a6: [4.1339, 5.8268],
});

const CM_PER_UNIT = Object.freeze({
  px: 2.54 / 96,
  in: 2.54,
  cm: 1,
  mm: 0.1,
});

/**
 * Convert a Puppeteer length (a number of CSS pixels, or a string with a
 * px/in/cm/mm unit) into the centimetres WebDriver's Print Page expects.
 *
 * @param {number|string} value
 * @returns {number}
 */
export function toCentimetres(value) {
  if (typeof value === 'number') {
    return value * CM_PER_UNIT.px;
  }
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*(px|in|cm|mm)?\s*$/i.exec(
    String(value)
  );
  if (!match) {
    throw new Error(`Cannot convert "${value}" to a print length`);
  }
  const unit = (match[2] ?? 'px').toLowerCase();
  return Number(match[1]) * CM_PER_UNIT[unit];
}

/**
 * PDF options that have no WebDriver Print Page equivalent. They are refused
 * rather than dropped, because a PDF without the header a caller asked for is
 * a silently wrong result (limitation `webdriver-print-options`).
 */
export const UNSUPPORTED_PRINT_OPTIONS = Object.freeze([
  'displayHeaderFooter',
  'headerTemplate',
  'footerTemplate',
  'preferCSSPageSize',
  'tagged',
  'outline',
  'omitBackground',
]);

/**
 * Translate Puppeteer/Playwright `page.pdf()` options into the parameters of
 * selenium-webdriver's `driver.printPage()`.
 *
 * @param {Object} [options]
 * @returns {Object} printPage options (lengths in centimetres)
 */
export function toPrintOptions(options = {}) {
  const unsupported = UNSUPPORTED_PRINT_OPTIONS.filter((name) => options[name]);
  if (unsupported.length > 0) {
    throw new Error(
      `WebDriver Print Page does not support ${unsupported.join(', ')} ` +
        '(see the webdriver-print-options limitation)'
    );
  }

  const print = {};
  if (options.landscape) {
    print.orientation = 'landscape';
  }
  if (options.printBackground !== undefined) {
    print.background = Boolean(options.printBackground);
  }
  if (options.scale !== undefined) {
    print.scale = options.scale;
  }
  if (options.pageRanges) {
    print.pageRanges = String(options.pageRanges)
      .split(',')
      .map((range) => range.trim())
      .filter(Boolean);
  }

  if (options.format) {
    const size = PAPER_FORMATS_IN[String(options.format).toLowerCase()];
    if (!size) {
      throw new Error(`Unknown paper format: ${options.format}`);
    }
    print.width = size[0] * CM_PER_UNIT.in;
    print.height = size[1] * CM_PER_UNIT.in;
  }
  if (options.width !== undefined) {
    print.width = toCentimetres(options.width);
  }
  if (options.height !== undefined) {
    print.height = toCentimetres(options.height);
  }

  for (const side of ['top', 'right', 'bottom', 'left']) {
    if (options.margin?.[side] !== undefined) {
      print[side] = toCentimetres(options.margin[side]);
    }
  }
  return print;
}

/**
 * A WebDriver cookie in the shape `page.cookies()` returns in Puppeteer.
 *
 * @param {Object} cookie - WebDriver cookie
 * @returns {Object}
 */
export function fromWebDriverCookie(cookie) {
  const session = cookie.expiry === undefined || cookie.expiry === null;
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path ?? '/',
    expires: session ? -1 : Number(cookie.expiry),
    size: `${cookie.name}${cookie.value}`.length,
    httpOnly: Boolean(cookie.httpOnly),
    secure: Boolean(cookie.secure),
    session,
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
  };
}

/**
 * A Puppeteer `setCookie()` argument as a WebDriver cookie.
 *
 * WebDriver can only add a cookie for the document that is loaded, so a
 * cookie's `url` is not a way to target another site here; the domain of the
 * current document applies unless `domain` names a parent of it.
 *
 * @param {Object} cookie - Puppeteer cookie parameter
 * @returns {Object}
 */
export function toWebDriverCookie(cookie) {
  const result = { name: cookie.name, value: cookie.value };
  for (const field of ['path', 'domain', 'secure', 'httpOnly', 'sameSite']) {
    if (cookie[field] !== undefined) {
      result[field] = cookie[field];
    }
  }
  if (typeof cookie.expires === 'number' && cookie.expires > 0) {
    result.expiry = Math.floor(cookie.expires);
  }
  return result;
}

/**
 * The page-side script that runs a function (or evaluates an expression) and
 * reports the document URL in the same round trip.
 *
 * The function source is part of the script body instead of being passed as an
 * argument and compiled in the page: WebDriver compiles the body outside the
 * page's Content-Security-Policy, whereas `new Function()` in the page is
 * refused on any site that forbids `unsafe-eval`.
 *
 * @param {Function|string} pageFunction
 * @returns {string} Script for `driver.executeScript`
 */
export function buildEvaluateScript(pageFunction) {
  const call =
    typeof pageFunction === 'function'
      ? `(${pageFunction.toString()}).apply(null, args)`
      : `(${pageFunction})`;
  return [
    'const args = Array.prototype.slice.call(arguments);',
    `return (async () => [await ${call}, location.href])();`,
  ].join('\n');
}

/**
 * A BiDi `log.entryAdded` entry as a Puppeteer ConsoleMessage.
 *
 * @param {Object} params
 * @returns {Object}
 */
export function toConsoleMessage(params) {
  const type = params.method ?? params.level ?? 'log';
  return {
    type: () => (type === 'warn' ? 'warning' : type),
    text: () => params.text ?? '',
    args: () => params.args ?? [],
    location: () => ({
      url: params.source?.url ?? params.stackTrace?.callFrames?.[0]?.url,
    }),
    level: params.level,
  };
}

/**
 * A BiDi network event as a Puppeteer HTTPRequest.
 *
 * @param {Object} params - BiDi network event parameters
 * @returns {Object}
 */
export function toNetworkRequest(params) {
  const request = params.request ?? {};
  const headers = Object.fromEntries(
    (request.headers ?? []).map(({ name, value }) => [
      name.toLowerCase(),
      value?.value ?? value,
    ])
  );
  return {
    id: request.request,
    url: () => request.url,
    method: () => request.method,
    headers: () => headers,
    isNavigationRequest: () => Boolean(params.navigation),
    failure: () =>
      params.errorText ? { errorText: params.errorText } : undefined,
    response: () =>
      params.response ? { status: () => params.response.status } : null,
  };
}
