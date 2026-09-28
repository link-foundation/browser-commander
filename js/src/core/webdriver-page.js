/**
 * WebDriverPage - a Puppeteer-shaped page over a selenium-webdriver session
 * (issue #104).
 *
 * Browser Commander's element, navigation and interaction helpers talk to a
 * page object: `page.evaluate`, `page.$`, `page.keyboard`, `page.on(...)` and so
 * on. Rather than teaching every helper a third dialect, the selenium engine
 * hands them this facade, which speaks the Puppeteer page API on top of W3C
 * WebDriver (classic commands) and WebDriver BiDi (events, preload scripts,
 * full-page screenshots). The `SeleniumAdapter` in `engine-adapter.js` then
 * only overrides the element operations where WebDriver has a better native
 * command.
 *
 * Elements are the driver's own `WebElement`s. They cross into
 * `page.evaluate()` as DOM nodes and come back out as `WebElement`s, which is
 * what WebDriver's script serialization does natively.
 *
 * What WebDriver cannot do is listed in the shared limitations catalogue
 * (`webdriver-*` entries) and fails with an error naming the entry.
 */

import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  buildEvaluateScript,
  fromWebDriverCookie,
  toPrintOptions,
  toWebDriverChord,
  toWebDriverCookie,
  toWebDriverKey,
} from './webdriver-conversions.js';
import { createWebDriverEventBridge } from './webdriver-events.js';

const require = createRequire(import.meta.url);

/** Mouse buttons in WebDriver input actions. */
const MOUSE_BUTTONS = Object.freeze({ left: 0, middle: 1, right: 2 });

const POLL_INTERVAL_MS = 100;

/** Error thrown when a wait runs out of time, named like Puppeteer's. */
export class WebDriverTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Open the BiDi connection selenium-webdriver keeps per driver.
 *
 * @param {Object} driver - selenium-webdriver WebDriver
 * @returns {Promise<Object>} The BiDi connection (`send`, `addCallback`)
 */
export async function connectBidi(driver) {
  try {
    const { Domain } = require('selenium-webdriver/bidi/domain');
    return await Domain.connect(driver);
  } catch (error) {
    // Releases before bidi/domain only have the (now deprecated) getBidi().
    if (error?.code === 'MODULE_NOT_FOUND' && driver.getBidi) {
      return driver.getBidi();
    }
    throw error;
  }
}

/**
 * Whether a value is a selenium-webdriver WebDriver (or a stand-in with the
 * same shape).
 *
 * @param {Object} value
 * @returns {boolean}
 */
export function isWebDriver(value) {
  return (
    typeof value?.findElements === 'function' &&
    typeof value?.executeScript === 'function' &&
    typeof value?.getCurrentUrl === 'function'
  );
}

/**
 * A page facade over a selenium-webdriver session.
 */
export class WebDriverPage extends EventEmitter {
  /**
   * @param {Object} driver - selenium-webdriver WebDriver
   * @param {Object} [options]
   * @param {Function} [options.connectBidi] - Opens the BiDi connection (tests)
   * @param {Function} [options.log] - Receives diagnostic messages
   */
  constructor(driver, options = {}) {
    super();
    if (!isWebDriver(driver)) {
      throw new TypeError('WebDriverPage needs a selenium-webdriver WebDriver');
    }
    this.driver = driver;
    this.engine = 'selenium';
    this.isWebDriverPage = true;
    this._url = 'about:blank';
    this._closed = false;
    this._connectBidi = options.connectBidi ?? connectBidi;
    this._log = options.log ?? (() => {});
    this._bidi = undefined; // undefined: not checked yet; null: classic session
    this._contextId = undefined;
    this._mouse = { x: 0, y: 0 };
    this._events = createWebDriverEventBridge(this);
    this._mainFrame = this._createMainFrame();
    this.keyboard = this._createKeyboard();
    this.mouse = this._createMouse();
  }

  // ==========================================================================
  // Event bridge
  // ==========================================================================

  on(eventName, listener) {
    super.on(eventName, listener);
    this._events.subscribe(eventName);
    return this;
  }

  addListener(eventName, listener) {
    return this.on(eventName, listener);
  }

  prependListener(eventName, listener) {
    super.prependListener(eventName, listener);
    this._events.subscribe(eventName);
    return this;
  }

  /** Resolves once every BiDi subscription requested so far is active. */
  eventsReady() {
    return this._events.ready();
  }

  /** @internal Called by the event bridge on a top-level navigation. */
  recordNavigation(url) {
    if (url) {
      this._url = url;
    }
    this.emit('framenavigated', this._mainFrame);
  }

  /** @internal Called by the event bridge when a subscription failed. */
  recordBridgeError(eventName, error) {
    this._log(`BiDi events for "${eventName}" unavailable: ${error.message}`);
  }

  // ==========================================================================
  // BiDi
  // ==========================================================================

  /**
   * The session's BiDi connection, or null for a classic session (no
   * `webSocketUrl` capability).
   *
   * @returns {Promise<Object|null>}
   */
  bidi() {
    if (this._bidi === undefined) {
      this._bidi = (async () => {
        const capabilities = await this.driver.getCapabilities();
        const webSocketUrl = capabilities?.get
          ? capabilities.get('webSocketUrl')
          : capabilities?.webSocketUrl;
        if (typeof webSocketUrl !== 'string') {
          return null;
        }
        return this._connectBidi(this.driver);
      })();
    }
    return this._bidi;
  }

  /**
   * The BiDi connection, or a clear error naming what needs it.
   *
   * @param {string} feature - What the caller was trying to do
   * @returns {Promise<Object>}
   */
  async requireBidi(feature) {
    const bidi = await this.bidi();
    if (!bidi) {
      throw new Error(
        `${feature} needs WebDriver BiDi; launch with bidi: true (or ask for ` +
          'the webSocketUrl capability). See the webdriver-classic-has-no-events limitation.'
      );
    }
    return bidi;
  }

  /**
   * Send a BiDi command and return its result.
   *
   * @param {string} method - e.g. 'browsingContext.navigate'
   * @param {Object} [params]
   * @returns {Promise<Object>}
   */
  async bidiCommand(method, params = {}) {
    const bidi = await this.requireBidi(method);
    const response = await bidi.send({ method, params });
    if (response?.error !== undefined || response?.type === 'error') {
      throw new Error(`${method}: ${response.error}: ${response.message}`);
    }
    return response?.result ?? response;
  }

  /**
   * Subscribe to a raw BiDi event.
   *
   * @param {string} method - e.g. 'log.entryAdded'
   * @param {Function} handler - Receives the event parameters
   * @returns {Promise<{unsubscribe: Function}>}
   */
  async subscribeBidi(method, handler) {
    const bidi = await this.requireBidi(`Subscribing to ${method}`);
    return bidi.addCallback(method, handler);
  }

  /**
   * Navigate with BiDi `browsingContext.navigate`, which reports the
   * navigation id and settles at the requested readiness.
   *
   * @param {string} url
   * @param {Object} [options]
   * @param {'none'|'interactive'|'complete'} [options.wait='complete']
   * @returns {Promise<{navigation: (string|null), url: string}>}
   */
  async navigateBidi(url, { wait = 'complete' } = {}) {
    const result = await this.bidiCommand('browsingContext.navigate', {
      context: await this.contextId(),
      url,
      wait,
    });
    this._url = result?.url ?? url;
    return result;
  }

  /**
   * The browsing context id of this page (its window handle, which WebDriver
   * BiDi uses as the context id).
   *
   * @returns {Promise<string>}
   */
  async contextId() {
    if (this._contextId === undefined) {
      this._contextId = await this.driver.getWindowHandle();
    }
    return this._contextId;
  }

  /** The context id when already known, otherwise undefined. */
  contextIdSync() {
    return this._contextId;
  }

  // ==========================================================================
  // Navigation and document
  // ==========================================================================

  /** The last URL WebDriver reported; refreshed by commands and BiDi events. */
  url() {
    return this._url;
  }

  /**
   * Ask the browser for the current URL and remember it.
   *
   * @returns {Promise<string>}
   */
  async syncUrl() {
    this._url = await this.driver.getCurrentUrl();
    return this._url;
  }

  async goto(url, options = {}) {
    if (options.timeout) {
      await this.driver.manage().setTimeouts({ pageLoad: options.timeout });
    }
    await this.driver.get(url);
    await this.syncUrl();
    return null;
  }

  async setContent(html) {
    await this.driver.executeScript(
      'document.open(); document.write(arguments[0]); document.close();',
      html
    );
    await this.syncUrl();
  }

  content() {
    return this.driver.getPageSource();
  }

  title() {
    return this.driver.getTitle();
  }

  async reload() {
    await this.driver.navigate().refresh();
    await this.syncUrl();
    return null;
  }

  async goBack() {
    await this.driver.navigate().back();
    await this.syncUrl();
    return null;
  }

  async goForward() {
    await this.driver.navigate().forward();
    await this.syncUrl();
    return null;
  }

  /**
   * WebDriver's Get and click commands already wait for the page load, so
   * there is no pending navigation to wait for: settle on the current URL.
   */
  async waitForNavigation() {
    await this.syncUrl();
    return null;
  }

  async bringToFront() {
    await this.driver.switchTo().window(await this.contextId());
  }

  // ==========================================================================
  // Script evaluation
  // ==========================================================================

  /**
   * Run a function (or expression) in the page, awaiting a returned promise.
   * DOM nodes in `args` may be WebElements; returned nodes come back as
   * WebElements.
   *
   * @param {Function|string} pageFunction
   * @param {...*} args
   * @returns {Promise<*>}
   */
  async evaluate(pageFunction, ...args) {
    const [result, href] = await this.driver.executeScript(
      buildEvaluateScript(pageFunction),
      ...args
    );
    if (typeof href === 'string') {
      this._url = href;
    }
    return result;
  }

  /**
   * Puppeteer's evaluateOnNewDocument, as a BiDi preload script.
   *
   * @param {Function|string} pageFunction
   * @param {...*} args - JSON-serialisable arguments
   * @returns {Promise<{identifier: string}>}
   */
  async evaluateOnNewDocument(pageFunction, ...args) {
    const source =
      typeof pageFunction === 'function'
        ? `(${pageFunction.toString()})(...${JSON.stringify(args)})`
        : pageFunction;
    const result = await this.bidiCommand('script.addPreloadScript', {
      functionDeclaration: `() => { ${source}; }`,
      contexts: [await this.contextId()],
    });
    return { identifier: result.script };
  }

  async removeScriptToEvaluateOnNewDocument(identifier) {
    await this.bidiCommand('script.removePreloadScript', {
      script: identifier,
    });
  }

  // ==========================================================================
  // Elements
  // ==========================================================================

  async $(selector) {
    const [element] = await this.driver.findElements({ css: selector });
    return element ?? null;
  }

  $$(selector) {
    return this.driver.findElements({ css: selector });
  }

  async $eval(selector, pageFunction, ...args) {
    const element = await this.$(selector);
    if (!element) {
      throw new Error(
        `Error: failed to find element matching selector "${selector}"`
      );
    }
    return this.evaluate(pageFunction, element, ...args);
  }

  async $$eval(selector, pageFunction, ...args) {
    return this.evaluate(pageFunction, await this.$$(selector), ...args);
  }

  /**
   * Poll for a selector like Puppeteer's waitForSelector.
   *
   * @param {string} selector - CSS selector
   * @param {Object} [options]
   * @param {boolean} [options.visible=false] - Wait until it is displayed
   * @param {boolean} [options.hidden=false] - Wait until it is gone or hidden
   * @param {number} [options.timeout=30000] - 0 waits forever
   * @returns {Promise<Object|null>} The element (null when waiting for hidden)
   */
  async waitForSelector(selector, options = {}) {
    const { visible = false, hidden = false, timeout = 30000 } = options;
    const deadline = timeout > 0 ? Date.now() + timeout : Infinity;
    for (;;) {
      const element = await this.$(selector);
      const displayed = element
        ? await element.isDisplayed().catch(() => false)
        : false;
      if (hidden && (!element || !displayed)) {
        return null;
      }
      if (!hidden && element && (!visible || displayed)) {
        return element;
      }
      if (Date.now() >= deadline) {
        throw new WebDriverTimeoutError(
          `Waiting for selector \`${selector}\` failed: ${timeout}ms exceeded`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  async _required(selector) {
    const element = await this.$(selector);
    if (!element) {
      throw new Error(`No element found for selector: ${selector}`);
    }
    return element;
  }

  async click(selector, options = {}) {
    const element = await this._required(selector);
    const count = options.clickCount ?? options.count ?? 1;
    const button = MOUSE_BUTTONS[options.button ?? 'left'];
    if (count === 1 && button === MOUSE_BUTTONS.left) {
      await element.click();
    } else {
      let actions = this._actions().move({ origin: element });
      for (let i = 0; i < count; i++) {
        actions = actions.press(button).release(button);
      }
      await actions.perform();
    }
    await this.syncUrl();
  }

  async type(selector, text) {
    const element = await this._required(selector);
    await element.sendKeys(text);
  }

  async focus(selector) {
    const element = await this._required(selector);
    await this.evaluate((el) => el.focus(), element);
  }

  // ==========================================================================
  // Input devices
  // ==========================================================================

  _actions() {
    return this.driver.actions({ async: true });
  }

  _createKeyboard() {
    const page = this;
    return {
      async press(key, options = {}) {
        const keys = toWebDriverChord(key);
        let actions = page._actions();
        for (const value of keys) {
          actions = actions.keyDown(value);
        }
        if (options.delay) {
          actions = actions.pause(options.delay);
        }
        for (const value of [...keys].reverse()) {
          actions = actions.keyUp(value);
        }
        await actions.perform();
        await page.syncUrl();
      },
      async type(text, options = {}) {
        if (!options.delay) {
          await page._actions().sendKeys(String(text)).perform();
          return;
        }
        for (const character of String(text)) {
          await page._actions().sendKeys(character).perform();
          await new Promise((resolve) => setTimeout(resolve, options.delay));
        }
      },
      async down(key) {
        await page._actions().keyDown(toWebDriverKey(key)).perform();
      },
      async up(key) {
        await page._actions().keyUp(toWebDriverKey(key)).perform();
      },
      async sendCharacter(character) {
        await page._actions().sendKeys(character).perform();
      },
    };
  }

  _createMouse() {
    const page = this;
    const at = (x, y) => ({
      x: Math.round(x),
      y: Math.round(y),
      origin: 'viewport',
    });
    return {
      async move(x, y) {
        await page._actions().move(at(x, y)).perform();
        page._mouse = { x, y };
      },
      async click(x, y, options = {}) {
        const button = MOUSE_BUTTONS[options.button ?? 'left'];
        let actions = page._actions().move(at(x, y));
        for (let i = 0; i < (options.clickCount ?? options.count ?? 1); i++) {
          actions = actions.press(button);
          if (options.delay) {
            actions = actions.pause(options.delay);
          }
          actions = actions.release(button);
        }
        await actions.perform();
        page._mouse = { x, y };
        await page.syncUrl();
      },
      async down(options = {}) {
        await page
          ._actions()
          .press(MOUSE_BUTTONS[options.button ?? 'left'])
          .perform();
      },
      async up(options = {}) {
        await page
          ._actions()
          .release(MOUSE_BUTTONS[options.button ?? 'left'])
          .perform();
      },
      async wheel({ deltaX = 0, deltaY = 0 } = {}) {
        const { x, y } = page._mouse;
        await page
          ._actions()
          .scroll(Math.round(x), Math.round(y), deltaX, deltaY, 'viewport')
          .perform();
      },
    };
  }

  // ==========================================================================
  // Capture
  // ==========================================================================

  /**
   * Take a screenshot. A viewport PNG is a classic WebDriver command;
   * `fullPage`, `clip` and JPEG/WebP need BiDi `browsingContext.captureScreenshot`.
   *
   * @param {Object} [options] - Puppeteer screenshot options
   * @returns {Promise<Buffer|string>}
   */
  async screenshot(options = {}) {
    const { path, fullPage = false, clip, encoding = 'binary' } = options;
    const type = options.type ?? (path?.match(/\.jpe?g$/i) ? 'jpeg' : 'png');
    let base64;
    if (!fullPage && !clip && type === 'png') {
      base64 = await this.driver.takeScreenshot();
    } else {
      const params = {
        context: await this.contextId(),
        origin: fullPage ? 'document' : 'viewport',
      };
      if (type !== 'png') {
        params.format = {
          type: `image/${type}`,
          ...(options.quality !== undefined
            ? { quality: options.quality / 100 }
            : {}),
        };
      }
      if (clip) {
        params.clip = { type: 'box', ...clip };
        delete params.clip.scale;
      }
      ({ data: base64 } = await this.bidiCommand(
        'browsingContext.captureScreenshot',
        params
      ));
    }
    const buffer = Buffer.from(base64, 'base64');
    if (path) {
      await writeFile(path, buffer);
    }
    return encoding === 'base64' ? base64 : buffer;
  }

  /**
   * Print to PDF with the WebDriver Print Page command.
   *
   * @param {Object} [options] - Puppeteer/Playwright pdf options
   * @returns {Promise<Buffer>}
   */
  async pdf(options = {}) {
    const buffer = Buffer.from(
      await this.driver.printPage(toPrintOptions(options)),
      'base64'
    );
    if (options.path) {
      await writeFile(options.path, buffer);
    }
    return buffer;
  }

  // ==========================================================================
  // Cookies
  // ==========================================================================

  async cookies() {
    const cookies = await this.driver.manage().getCookies();
    return cookies.map(fromWebDriverCookie);
  }

  async setCookie(...cookies) {
    for (const cookie of cookies) {
      await this.driver.manage().addCookie(toWebDriverCookie(cookie));
    }
  }

  async deleteCookie(...cookies) {
    for (const cookie of cookies) {
      await this.driver.manage().deleteCookie(cookie.name);
    }
  }

  // ==========================================================================
  // Frames and lifecycle
  // ==========================================================================

  _createMainFrame() {
    const page = this;
    return {
      url: () => page.url(),
      name: () => '',
      parentFrame: () => null,
      childFrames: () => [],
      isDetached: () => page._closed,
      page: () => page,
      evaluate: (pageFunction, ...args) => page.evaluate(pageFunction, ...args),
    };
  }

  mainFrame() {
    return this._mainFrame;
  }

  frames() {
    return [this._mainFrame];
  }

  isClosed() {
    return this._closed;
  }

  /** Detach event subscriptions; the session itself stays open. */
  async dispose() {
    await this._events.dispose();
  }

  /** Close this page's window. */
  async close() {
    await this.dispose();
    await this.driver.close();
    this._closed = true;
    this.emit('close');
  }
}

/**
 * Wrap a WebDriver session and read its current URL and window handle, so
 * `page.url()` is right from the first call.
 *
 * @param {Object} driver - selenium-webdriver WebDriver
 * @param {Object} [options] - WebDriverPage options
 * @returns {Promise<WebDriverPage>}
 */
export async function createWebDriverPage(driver, options = {}) {
  const page = new WebDriverPage(driver, options);
  await page.contextId();
  await page.syncUrl();
  return page;
}
