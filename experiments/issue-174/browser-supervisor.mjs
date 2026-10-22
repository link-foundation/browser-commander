// An embedding supervisor that keeps a launched Chrome across its own Ctrl+C.
// Usage: node browser-supervisor.mjs <managed|caller> <engine> <handoff.json>
//
// It launches Chrome, opens a page "waiting for a human", installs its own
// SIGINT handler that hands the browser off to handoff.json, and interrupts
// itself. With interruption 'caller' the browser survives; with the default
// 'managed' Command Stream forwards SIGINT to Chrome before the handler runs.
import { writeFileSync } from 'node:fs';
import { launchBrowser } from '../../js/src/browser/launcher.js';

const [mode = 'caller', engine = 'playwright', handoffFile] =
  process.argv.slice(2);
const session = await launchBrowser({
  engine,
  headless: true,
  ...(mode === 'caller' ? { interruption: 'caller' } : {}),
  // Without a path the launch would start Chrome for Testing (issue #179).
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
  args: process.env.CHROME_NO_SANDBOX === 'true' ? ['--no-sandbox'] : [],
});
const url = 'data:text/html,<title>waiting for a human</title><input id=otp>';
if (engine === 'selenium') {
  await session.browser.get(url);
} else {
  await session.page.goto(url);
}
writeFileSync(`${handoffFile}.pid`, String(session.browserProcess.pid));
process.on('SIGINT', async () => {
  try {
    const handoff = await session.detach();
    writeFileSync(handoffFile, JSON.stringify(handoff));
  } catch (error) {
    process.stderr.write(`detach failed: ${error.message}\n`);
  }
  process.exit(130);
});
process.kill(process.pid, 'SIGINT');
