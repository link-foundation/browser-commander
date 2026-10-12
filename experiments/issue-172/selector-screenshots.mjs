import { launchBrowser } from '../../js/src/browser/launcher.js';
import { fileURLToPath } from 'node:url';

async function capture(page) {
  const { execFileSync } = await import('node:child_process');
  const { mkdir } = await import('node:fs/promises');
  const root = fileURLToPath(new URL('../../', import.meta.url)).replace(
    /\/$/,
    ''
  );
  const { makeBrowserCommander } = await import(`${root}/js/src/factory.js`);
  const source = execFileSync(
    'git',
    ['show', '4d49e7c:js/src/elements/selectors.js'],
    { cwd: root, encoding: 'utf8' }
  )
    .replace(
      '../core/navigation-safety.js',
      `file://${root}/js/src/core/navigation-safety.js`
    )
    .replace('./locators.js', `file://${root}/js/src/elements/locators.js`);
  const previous = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  );
  const commander = makeBrowserCommander({
    page,
    verbose: false,
    enableNetworkTracking: false,
    enableNavigationManager: false,
  });
  const html = `<style>
    body { font: 18px system-ui; padding: 32px; max-width: 800px; color: #172238; }
    nav, .parent { padding: 24px; border: 2px solid #bac7d8; margin: 20px 0; border-radius: 10px; }
    button { font: inherit; padding: 12px 28px; margin-right: 12px; cursor: pointer; }
    output { display: block; font-weight: bold; padding: 20px; background: #edf2f7; }
    [data-clicked] { outline: 4px solid #db4b39; }
    .parent [data-clicked] { outline-color: #178553; }
  </style><h1>Scoped text selector regression</h1>
  <p>Requested: <code>.parent button:has-text("B")</code></p>
  <nav><p>Unrelated navigation</p><button>Home</button><button onclick="record(this,'nav-2')">About</button></nav>
  <div class="parent"><p>Intended container</p><button onclick="record(this,'A')">A</button><button onclick="record(this,'B')">B</button></div>
  <output id="result">No button clicked</output>
  <script>function record(button, value) { window.clicked=value; button.dataset.clicked='true'; document.querySelector('output').textContent='Expected B; clicked '+value; }</script>`;
  await page.setViewportSize({ width: 960, height: 700 });
  await mkdir(`${root}/docs/screenshots`, { recursive: true });
  try {
    const requested = '.parent button:has-text("B")';
    await page.setContent(html);
    const normalized = await previous.normalizeSelector({
      page,
      engine: 'playwright',
      selector: requested,
    });
    await commander.clickButton({ selector: normalized, verify: false });
    const before = await page.evaluate(() => window.clicked);
    await page.screenshot({
      path: `${root}/docs/screenshots/issue-172-selector-before.png`,
    });
    await page.setContent(html);
    await commander.clickButton({ selector: requested, verify: false });
    const after = await page.evaluate(() => window.clicked);
    await page.screenshot({
      path: `${root}/docs/screenshots/issue-172-selector-after.png`,
    });
    if (before !== 'nav-2' || after !== 'B') {
      throw new Error(`Unexpected targets: ${before}, ${after}`);
    }
    return { normalized, before, after };
  } finally {
    await commander.destroy();
  }
}

const session = await launchBrowser({
  headless: true,
  debug: false,
  ...(process.env.CHROME_NO_SANDBOX === 'true'
    ? { args: ['--no-sandbox'] }
    : {}),
});
try {
  console.log(await capture(session.page));
} finally {
  await session.close();
}
