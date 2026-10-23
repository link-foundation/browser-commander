// Where a persistent-profile restart spends its time (issue #187 e2e speed).
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser } from '../../js/src/browser/launcher.js';
import { makeBrowserCommander } from '../../js/src/factory.js';

const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'bc-187-timing-'));
const options = {
  headless: true,
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
  userDataDir,
};
let t = Date.now();
const lap = (label) => {
  console.log(label, Date.now() - t, 'ms');
  t = Date.now();
};
const first = await launchBrowser(options);
lap('launch');
const commander = makeBrowserCommander({
  page: first.page,
  enableNetworkTracking: false,
  enableNavigationManager: false,
});
await commander.goto({ url: 'data:text/html,<title>x</title>' });
lap('goto');
await commander.evaluate({ fn: () => document.title });
lap('evaluate');
await first.close();
lap('close');
await rm(userDataDir, { recursive: true, force: true });
