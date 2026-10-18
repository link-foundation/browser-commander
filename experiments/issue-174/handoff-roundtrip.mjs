// Launch -> detach -> reconnect -> close with a real Chrome, for one engine.
// Usage: node experiments/issue-174/handoff-roundtrip.mjs [playwright|puppeteer|selenium]
import { launchBrowser } from '../../js/src/browser/launcher.js';
import { reconnectBrowser } from '../../js/src/browser/browser-handoff.js';

const engine = process.argv[2] ?? 'playwright';
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const launched = await launchBrowser({
  engine,
  headless: true,
  interruption: 'caller',
  args: process.env.CHROME_NO_SANDBOX === 'true' ? ['--no-sandbox'] : [],
});
console.log('launched', Object.keys(launched).sort().join(','));
const url = 'data:text/html,<title>waiting for a human</title><input id=otp>';
if (engine === 'selenium') {
  await launched.browser.get(url);
} else {
  await launched.page.goto(url);
}
const handoff = await launched.detach();
console.log('handoff', JSON.stringify(handoff));
console.log('alive after detach', alive(handoff.pid));
const again = await reconnectBrowser(JSON.stringify(handoff));
const title =
  engine === 'selenium'
    ? await again.browser.getTitle()
    : await again.page.title();
console.log('reconnected title', title);
const second = await again.detach();
console.log('same target', second.targetId === handoff.targetId);
const third = await reconnectBrowser(second);
await third.close();
console.log('alive after close', alive(handoff.pid));
