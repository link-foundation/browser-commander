// Keep a human-facing browser across Ctrl+C and pick it up in the next run
// (issue #174).
//
//   node examples/browser-handoff.mjs /tmp/handoff.json   # launch; press Ctrl+C
//   node examples/browser-handoff.mjs /tmp/handoff.json   # reattach, then close
//
// The first run launches Chrome with caller-owned interruption, so Ctrl+C
// reaches only this script; its handler detaches and writes the hand-off. The
// second run reattaches to the exact tab and closes the browser. Pass
// --interrupt to send the first run's Ctrl+C automatically.
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, reconnectBrowser } from '../js/src/index.js';

const [handoffFile, flag] = process.argv.slice(2);
if (!handoffFile || !path.isAbsolute(handoffFile)) {
  throw new Error(
    'Usage: node examples/browser-handoff.mjs /absolute/handoff.json [--interrupt]'
  );
}
const launchOptions = {
  headless: flag === '--interrupt',
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : {}),
  args: process.env.CHROME_NO_SANDBOX === 'true' ? ['--no-sandbox'] : [],
};

if (existsSync(handoffFile)) {
  const session = await reconnectBrowser(handoffFile);
  console.log(`Reattached to "${await session.page.title()}"`);
  await session.close();
  rmSync(handoffFile);
  console.log(`Closed the browser (pid ${session.pid})`);
} else {
  const session = await launchBrowser({
    ...launchOptions,
    interruption: 'caller',
  });
  await session.page.goto(
    'data:text/html,<title>waiting for a human</title><input placeholder=code>'
  );
  process.on('SIGINT', async () => {
    writeFileSync(handoffFile, JSON.stringify(await session.detach()));
    console.log(`Browser kept open; run again to reattach (${handoffFile})`);
    process.exit(130);
  });
  console.log('Browser open. Press Ctrl+C to hand it off.');
  if (flag === '--interrupt') {
    process.kill(process.pid, 'SIGINT');
  }
}
