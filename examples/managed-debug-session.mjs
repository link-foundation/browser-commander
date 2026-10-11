import path from 'node:path';
import { launchBrowser, makeBrowserCommander } from '../js/src/index.js';

// Supply an application-owned absolute evidence root; never infer it from cwd.
const directory = process.argv[2];
if (!directory || !path.isAbsolute(directory)) {
  throw new Error(
    'Usage: node examples/managed-debug-session.mjs /owned/evidence [--wait-for-signal]'
  );
}
let finish;
const interrupted = new Promise((resolve) => {
  finish = resolve;
});
const onSignal = () => finish();
for (const signal of ['SIGINT', 'SIGTERM']) {
  // Keep handlers registered through teardown: subprocess libraries may inspect
  // listener counts while forwarding SIGINT to the browser.
  process.on(signal, onSignal);
}
let launched, commander;
try {
  launched = await launchBrowser({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
    args: process.env.CHROME_NO_SANDBOX === 'true' ? ['--no-sandbox'] : [],
    debug: {
      directory,
      retain: false,
      maxDurationMs: 60000,
      limits: { maxBundleBytes: 8 * 1024 * 1024 },
    },
  });
  commander = makeBrowserCommander({ page: launched.page });
  await commander.ready;
  await commander.goto({
    url: 'data:text/html,<h1>Application-owned recording</h1>',
    waitForStableUrlBefore: false,
    waitForStableUrlAfter: false,
    waitForNetworkIdle: false,
  });
  console.log(JSON.stringify({ tracePath: commander.tracePath, ready: true }));
  if (process.argv.includes('--wait-for-signal')) {
    await interrupted;
  }
} finally {
  try {
    await commander?.destroy();
  } finally {
    await launched?.close();
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.removeListener(signal, onSignal);
    }
  }
}
