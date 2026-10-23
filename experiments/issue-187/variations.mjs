// Print the field-trial features Chrome for Testing enables by default
// (chrome://version/?show-variations-cmd), filtered by a regex.
//   node experiments/issue-187/variations.mjs <chrome> <regex> [switch ...]
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const [chrome, pattern, ...switches] = process.argv.slice(2);
const dir = fs.mkdtempSync('/tmp/bc-var-');
const port = 9800 + Math.floor(Math.random() * 100);
const child = spawn(chrome, [`--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, ...switches, 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 100 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await new Promise((r) => setTimeout(r, 100)); }
}
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const waiting = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m); });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
await send('Page.navigate', { url: 'chrome://version/?show-variations-cmd' });
await new Promise((r) => setTimeout(r, 1500));
const { result } = await send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
const text = result.result.value;
const re = new RegExp(pattern, 'i');
const items = text.split(/[,\s<>/:]+/).filter((s) => re.test(s));
console.log([...new Set(items)].join('\n'));
child.kill();
