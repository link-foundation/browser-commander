// Time commander.goto()/fill()/click() on the selenium engine with verbose
// logs, to see where a slow step waits (issue #104). From the repository root:
//   xvfb-run -a node experiments/issue-104/goto-timing.mjs [--bidi]
import { createServer } from 'node:http';
import { launchWebDriver, makeBrowserCommander } from '../../js/src/index.js';

const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<title>t</title><input id=q><button id=b>b</button>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const session = await launchWebDriver({
  headless: true,
  bidi: process.argv.includes('--bidi'),
  executablePath: process.env.CHROME_PATH,
});
const started = Date.now();
const stamp = (label) => console.log(`[${Date.now() - started}ms] ${label}`);
try {
  const commander = makeBrowserCommander({
    page: session.page,
    verbose: true,
  });
  stamp('goto start');
  await commander.goto({ url });
  stamp('goto done');
  await commander.fill({ selector: '#q', text: 'x' });
  stamp('fill done');
  await commander.click({ selector: '#b' });
  stamp('click done');
  await commander.destroy?.();
} finally {
  await session.close();
  server.close();
}
