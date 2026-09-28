/**
 * Does a hand-started headless Chrome (no debugger at all) report
 * navigator.webdriver === true, with and without a fixed debugging port?  Prints the probe's webdriver fields.
 *
 *   node experiments/issue-103/headless-webdriver.mjs
 */
import { randomUUID } from 'node:crypto';
import { reserveLoopbackPort } from '../../js/src/browser/debugging-port.js';
import {
  captureReferenceReport,
  readProbeSource,
  startProbeServer,
} from '../../js/src/parity/harness.js';

const server = await startProbeServer(await readProbeSource());
try {
  const port = `--remote-debugging-port=${await reserveLoopbackPort()}`;
  for (const extraArgs of [
    [],
    ['--disable-blink-features=AutomationControlled'],
    [port],
    [port, '--disable-blink-features=AutomationControlled'],
  ]) {
    const report = await captureReferenceReport({
      executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
      server,
      token: randomUUID(),
      headless: true,
      extraArgs,
    });
    console.log(
      JSON.stringify(extraArgs),
      'navigator.webdriver =',
      report.navigator?.webdriver
    );
  }
} finally {
  await server.close();
}
