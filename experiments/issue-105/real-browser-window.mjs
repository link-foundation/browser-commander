// Screenshot source (#101, #103): open a headful window with
// launchRealBrowser, navigate the tab it drives to a page that shows
// navigator.webdriver and the tab's visibility, print READY for
// chrome-window-shot.sh, and close the session when stdin ends.
// Usage: bash experiments/issue-105/chrome-window-shot.sh out.png \
//          experiments/issue-105/real-browser-window.mjs
import { launchRealBrowser } from '../../js/src/browser/real-browser.js';

const session = await launchRealBrowser({
  engine: process.env.ENGINE ?? 'playwright',
  restrictions: (process.env.RESTRICTIONS ?? '').split(',').filter(Boolean),
});
const html = `<title>browser-commander</title><body style="font:28px sans-serif;padding:40px">
<p>navigator.webdriver = <b id=w></b></p><p>document.visibilityState = <b id=v></b></p>
<p style="font:16px monospace">${session.args.join(' ')}</p>
<script>w.textContent=navigator.webdriver;v.textContent=document.visibilityState</script>`;
await session.page.goto(`data:text/html,${encodeURIComponent(html)}`);
console.log('READY', JSON.stringify(session.args));
process.stdin.resume();
await new Promise((resolve) => process.stdin.once('end', resolve));
await session.close();
