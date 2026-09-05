/**
 * Isolate what turns navigator.webdriver on when remote debugging is enabled.
 *
 * The baseline matrix said a CDP-attached Chrome reports webdriver=false while
 * the flag matrix said `--remote-debugging-port=0` reports webdriver=true.
 * Both cannot be right, so every variable is varied one at a time here.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  killProcessTree,
  readProbeSource,
  startProbeServer,
} from './harness.mjs';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const HEADLESS = process.env.PARITY_HEADLESS === 'true';

const BASE_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate',
];

const CASES = [
  ['control-no-debugging', []],
  ['port-zero', ['--remote-debugging-port=0']],
  ['port-fixed', ['--remote-debugging-port=9333']],
  [
    'port-fixed-address',
    ['--remote-debugging-port=9334', '--remote-debugging-address=127.0.0.1'],
  ],
  ['port-zero-twice', ['--remote-debugging-port=0']],
  ['pipe', ['--remote-debugging-pipe']],
];

async function capture(name, extraArgs) {
  const server = globalThis.__parityServer;
  const token = `iso-${name}`;
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'bc-iso-'));
  // --remote-debugging-pipe reads CDP from fd 3 and writes to fd 4; without
  // those descriptors Chrome refuses to start, so always provide them.
  const child = spawn(
    CHROME,
    [
      `--user-data-dir=${userDataDir}`,
      ...BASE_ARGS,
      ...(HEADLESS ? ['--headless=new'] : []),
      ...extraArgs,
      server.url(token),
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], detached: true }
  );
  try {
    const report = await server.waitForReport(token, 45000);
    return { webdriver: report?.navigator?.webdriver ?? null };
  } catch (error) {
    return { error: String(error && error.message) };
  } finally {
    await killProcessTree(child);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 10 });
  }
}

async function main() {
  const server = await startProbeServer(await readProbeSource());
  globalThis.__parityServer = server;
  const rows = {};
  try {
    for (const [name, extraArgs] of CASES) {
      rows[name] = await capture(name, extraArgs);
      console.log(`${name}: ${JSON.stringify(rows[name])}`);
    }
  } finally {
    await server.close();
  }
  const outputPath =
    process.argv[2] ||
    path.join(process.cwd(), 'remote-debugging-isolation.json');
  await writeFile(outputPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  console.log(`wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
