/**
 * Fake engine objects for the CLI and JSON-RPC dispatcher tests (issue #104).
 *
 * The dispatcher only calls a handful of page methods for its high-level
 * methods, so a small in-memory page is enough to check what it sends and
 * what it returns without a browser.
 */
import { EventEmitter } from 'node:events';

/** A page that records calls and keeps a URL, a title and field values. */
export class FakePage extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.currentUrl = 'about:blank';
    this.values = {};
    this.cookies = [];
  }

  async goto(url) {
    this.calls.push(['goto', url]);
    this.currentUrl = url;
  }

  url() {
    return this.currentUrl;
  }

  async title() {
    return `Title of ${this.currentUrl}`;
  }

  async click(selector) {
    this.calls.push(['click', selector]);
  }

  async fill(selector, value) {
    this.calls.push(['fill', selector, value]);
    this.values[selector] = value;
  }

  locator(selector) {
    return { fill: (value) => this.fill(selector, value) };
  }

  async evaluate(expression, ...args) {
    this.calls.push(['evaluate', expression]);
    return typeof expression === 'function'
      ? expression(...args)
      : { expression };
  }

  async screenshot(options = {}) {
    this.calls.push(['screenshot', options]);
    return Buffer.from('png-bytes');
  }

  async pdf(options = {}) {
    this.calls.push(['pdf', options]);
    return Buffer.from('%PDF');
  }

  async setCookie(...cookies) {
    this.cookies.push(...cookies);
  }

  context() {
    return this.owner;
  }
}

/** A Playwright-like context owning one page. */
export class FakeContext {
  constructor(page) {
    this.page = page;
    page.owner = this;
    this.cookies = [];
  }

  pages() {
    return [this.page];
  }

  async addCookies(cookies) {
    if (cookies.some((cookie) => cookie.name === 'bad')) {
      throw new Error('Invalid cookie fields');
    }
    this.cookies.push(...cookies);
  }
}

/**
 * Dependencies for `createDispatcher()` backed by fakes.
 *
 * @returns {{dependencies: Object, launches: Object[], connections: Object[], pages: FakePage[]}}
 */
export function createFakeDependencies() {
  const launches = [];
  const connections = [];
  const pages = [];
  const newPage = () => {
    const page = new FakePage();
    pages.push(page);
    return page;
  };
  const dependencies = {
    packageInfo: async () => ({
      name: 'browser-commander',
      version: '0.0.0-test',
      language: 'js',
    }),
    launchBrowser: async (options) => {
      const page = newPage();
      const context = new FakeContext(page);
      const record = { options, closed: false };
      launches.push(record);
      return {
        browser: context,
        page,
        connectedBrowser: { name: 'fake-browser' },
        cdpEndpoint: 'http://127.0.0.1:9222',
        remoteDebuggingPort: 9222,
        userDataDir: '/tmp/fake-profile',
        temporaryProfile: true,
        args: ['--user-data-dir=/tmp/fake-profile'],
        close: async () => {
          record.closed = true;
        },
      };
    },
    connectBrowser: async (options) => {
      const page = newPage();
      const context = new FakeContext(page);
      const record = { options, closed: false, disconnected: false };
      connections.push(record);
      const browser = new EventEmitter();
      browser.close = async () => {
        record.closed = true;
      };
      browser.disconnect = async () => {
        record.disconnected = true;
      };
      browser.defaultBrowserContext = () => context;
      return { browser, page };
    },
    startTrace: async ({ output }) => ({
      path: output,
      stopped: false,
      async stop() {
        this.stopped = true;
      },
    }),
    writeTraceViewer: async (bundle, output) =>
      output ?? `${bundle}/viewer.html`,
    readBrowserCookies: async ({ domainFilter }) => [
      { name: 'sid', value: '1', domain: `.${domainFilter}`, path: '/' },
      { name: 'bad', value: '2', domain: `.${domainFilter}`, path: '/' },
    ],
    loadEngine: async (name) => ({ default: new FakeEngine(name) }),
    openInUserBrowser: async (url) => ({ opened: url, command: ['open', url] }),
    migrateProfile: async (options) => ({ migrated: {}, options }),
    measureParity: async () => ({ ok: true, unlisted: [] }),
  };
  return { dependencies, launches, connections, pages };
}

/** A stand-in for the Playwright or Puppeteer entry object. */
export class FakeEngine {
  constructor(name) {
    this.name = name;
  }

  launch() {
    return `launched with ${this.name}`;
  }
}
