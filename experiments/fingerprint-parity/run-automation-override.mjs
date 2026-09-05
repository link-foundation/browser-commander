/**
 * Can `Emulation.setAutomationOverride` turn navigator.webdriver back off?
 *
 * This matters for `connectBrowser`: when Browser Commander attaches to a
 * browser somebody else launched, the launch switches are already fixed and a
 * CDP-side override would be the only remedy.
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const engineRequire = createRequire(
  `${process.env.BC_JS_ROOT || path.resolve('js')}/package.json`
);
const { chromium } = await import(
  new URL(`file://${engineRequire.resolve('playwright')}`).href
).then((loaded) => loaded.default ?? loaded);

const browser = await chromium.launch({
  headless: true,
  executablePath: CHROME,
});
const page = await browser.newPage();
const session = await page.context().newCDPSession(page);

console.log('before override:', await page.evaluate(() => navigator.webdriver));

try {
  await session.send('Emulation.setAutomationOverride', { enabled: false });
  console.log('setAutomationOverride(false) accepted');
} catch (error) {
  console.log('setAutomationOverride(false) failed:', error.message);
}
console.log('same document:', await page.evaluate(() => navigator.webdriver));

await page.goto('about:blank');
console.log(
  'after navigation:',
  await page.evaluate(() => navigator.webdriver)
);

await browser.close();
