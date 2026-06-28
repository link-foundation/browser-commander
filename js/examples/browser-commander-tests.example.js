import { assert, browserTest } from '../src/tests/index.js';

const engines = process.env.BROWSER_COMMANDER_TEST_ENGINE
  ? process.env.BROWSER_COMMANDER_TEST_ENGINE.split(',')
  : undefined;

browserTest(
  'loads example.com',
  async ({ commander, engine, testInfo }) => {
    await commander.goto({
      url: process.env.TEST_URL || 'https://example.com',
      waitForNetworkIdle: false,
    });

    const heading = await commander.textContent({ selector: 'h1' });
    assert.ok(
      heading.includes('Example Domain'),
      `${testInfo.name} should read the heading with ${engine}`
    );
  },
  {
    engines,
    launchOptions: {
      headless: process.env.HEADLESS !== 'false',
    },
    retries: process.env.CI ? 1 : 0,
    timeoutMs: 60000,
    artifactsDir: 'test-results/browser-commander-example',
  }
);
