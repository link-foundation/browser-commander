/**
 * API coverage of the generic handle methods (issue #104).
 *
 * `serve --stdio` promises that any public Playwright or Puppeteer method can
 * be called through `handle.call`, so the Rust and Python ports need no
 * binding per method. This suite walks the real engine objects through the
 * same dispatcher `serve` uses and asserts that `handle.describe` lists every
 * method the engine declares for that type:
 *
 * - Puppeteer: `puppeteer-core/lib/types.d.ts`.
 * - Playwright: `playwright-core/types/types.d.ts`. Playwright's wire
 *   protocol description (`protocol.yml`) is not shipped in the npm
 *   package, so the published client API declarations are the reference.
 *
 * When an engine upgrade adds a method, the declarations grow and this test
 * shows whether the bridge reaches it.
 *
 * Run with: npm run test:e2e:api-coverage
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert';

import { createDispatcher } from '../../src/cli/dispatcher.js';
import {
  playwrightDeclarations,
  puppeteerDeclarations,
} from '../helpers/declared-api.js';
import { CHROME_LAUNCH_OPTIONS } from '../helpers/e2e-browser.js';
import { sendHtml, startFixtureHost } from '../helpers/fixture-server.js';

const E2E = { skip: !process.env.RUN_E2E, timeout: 180_000 };

const PAGE = `<!doctype html><title>API coverage</title>
<p id="text">coverage</p><iframe srcdoc="<p>inner</p>"></iframe>`;

/**
 * How to reach one declared type from the session roots. Each step is
 * `['call', method, args]` or `['get', property]`, run with handle.call or
 * handle.get on the previous handle; `from` names the starting handle.
 */
/** Page-level types both engines expose the same way, under their own names. */
function sharedPaths({ response, request }) {
  return {
    Browser: { from: 'browser', steps: [] },
    BrowserContext: { from: 'context', steps: [] },
    Page: { from: 'page', steps: [] },
    [response]: { from: 'page', steps: [['call', 'goto', ['$url']]] },
    [request]: {
      from: 'page',
      steps: [
        ['call', 'goto', ['$url']],
        ['call', 'request', []],
      ],
    },
    Frame: { from: 'page', steps: [['call', 'mainFrame', []]] },
    ElementHandle: { from: 'page', steps: [['call', '$', ['#text']]] },
    JSHandle: {
      from: 'page',
      steps: [['call', 'evaluateHandle', [{ $function: '() => window' }]]],
    },
    Locator: { from: 'page', steps: [['call', 'locator', ['#text']]] },
    Keyboard: { from: 'page', steps: [['get', 'keyboard']] },
    Mouse: { from: 'page', steps: [['get', 'mouse']] },
    Touchscreen: { from: 'page', steps: [['get', 'touchscreen']] },
    Coverage: { from: 'page', steps: [['get', 'coverage']] },
  };
}

const PLAYWRIGHT_PATHS = {
  ...sharedPaths({ response: 'Response', request: 'Request' }),
  FrameLocator: { from: 'page', steps: [['call', 'frameLocator', ['iframe']]] },
  Clock: { from: 'page', steps: [['get', 'clock']] },
  APIRequestContext: { from: 'page', steps: [['get', 'request']] },
  Tracing: { from: 'context', steps: [['get', 'tracing']] },
  CDPSession: {
    from: 'context',
    steps: [['call', 'newCDPSession', ['$page']]],
  },
  BrowserType: { from: 'engine', steps: [['get', 'chromium']] },
  APIRequest: { from: 'engine', steps: [['get', 'request']] },
  Selectors: { from: 'engine', steps: [['get', 'selectors']] },
};

const PUPPETEER_PATHS = {
  ...sharedPaths({ response: 'HTTPResponse', request: 'HTTPRequest' }),
  PuppeteerNode: { from: 'engine', steps: [] },
  Accessibility: { from: 'page', steps: [['get', 'accessibility']] },
  Tracing: { from: 'page', steps: [['get', 'tracing']] },
  Target: { from: 'page', steps: [['call', 'target', []]] },
  CDPSession: { from: 'page', steps: [['call', 'createCDPSession', []]] },
};

const ENGINES = {
  playwright: { paths: PLAYWRIGHT_PATHS, declarations: playwrightDeclarations },
  puppeteer: { paths: PUPPETEER_PATHS, declarations: puppeteerDeclarations },
};

/** Follow one path from the session roots to a handle. */
async function reach(dispatch, roots, { from, steps }, url) {
  const substitute = (arg) =>
    arg === '$url' ? url : arg === '$page' ? roots.page : arg;
  let handle = roots[from];
  for (const [kind, name, args = []] of steps) {
    handle =
      kind === 'get'
        ? await dispatch('handle.get', { handle, property: name })
        : await dispatch('handle.call', {
            handle,
            method: name,
            args: args.map(substitute),
          });
  }
  return handle;
}

for (const [engine, { paths, declarations }] of Object.entries(ENGINES)) {
  describe(`E2E - handle.describe covers the ${engine} API (issue #104)`, () => {
    let server;
    let dispatcher;
    let roots;

    before(async () => {
      if (!process.env.RUN_E2E) {
        return;
      }
      server = await startFixtureHost((_path, _req, res) =>
        sendHtml(res, PAGE)
      );
      dispatcher = createDispatcher();
      const { session } = await dispatcher.dispatch('session.launch', {
        engine,
        headless: true,
        ...CHROME_LAUNCH_OPTIONS,
      });
      roots = {
        ...(await dispatcher.dispatch('handle.root', {
          name: `session:${session}`,
        })),
        engine: await dispatcher.dispatch('handle.root', { name: engine }),
      };
    });

    after(async () => {
      await dispatcher?.close();
      await server?.close();
    });

    it('every mapped type is still declared by the engine', E2E, () => {
      const declared = declarations();
      const missing = Object.keys(paths).filter((type) => !declared.has(type));
      assert.deepEqual(missing, []);
    });

    for (const type of Object.keys(paths)) {
      it(`${type}: every declared method is reachable`, E2E, async () => {
        const { dispatch } = dispatcher;
        const handle = await reach(
          dispatch,
          roots,
          paths[type],
          server.baseUrl
        );
        assert.ok(handle?.$handle, `${type} did not resolve to a handle`);

        const described = await dispatch('handle.describe', { handle });
        const available = new Set(described.methods);
        const missing = [...declarations().get(type)].filter(
          (method) => !available.has(method)
        );
        assert.deepEqual(missing, [], `${type} (${described.type})`);
      });
    }
  });
}
