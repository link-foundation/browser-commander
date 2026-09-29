/**
 * Run measureParity() for every launch mode and engine and print a summary.
 *
 *   CHROME_PATH=/usr/bin/google-chrome xvfb-run -a node experiments/issue-103/measure-parity.mjs [--headless] [--channel chromium]
 */
import { measureParity } from '../../js/src/browser/parity.js';

const argv = process.argv.slice(2);
const headless = argv.includes('--headless');
const channelIndex = argv.indexOf('--channel');
const channel = channelIndex === -1 ? undefined : argv[channelIndex + 1];
const executablePath = channel
  ? undefined
  : process.env.CHROME_PATH || '/usr/bin/google-chrome';

for (const engine of ['playwright', 'puppeteer']) {
  for (const launch of ['real', 'engine']) {
    const report = await measureParity({
      engine,
      launch,
      headless,
      channel,
      executablePath,
    });
    console.log(
      JSON.stringify(
        {
          engine,
          launch,
          headless,
          version: report.browser.version,
          ok: report.ok,
          extra: report.commandLine.extra,
          attachment: report.commandLine.attachment,
          differences: report.differences.map(
            (d) =>
              `${d.path}${d.limitation ? ` [${d.limitation}]` : ''}${d.requested ? ' [requested]' : ''}`
          ),
        },
        null,
        1
      )
    );
  }
}
