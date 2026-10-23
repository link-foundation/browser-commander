// Puppeteer engine launch: does a session cookie survive a restart?
//   node experiments/issue-187/puppeteer-engine.mjs <chrome> [switch ...]
import puppeteer from '../../js/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import fs from 'node:fs';
import path from 'node:path';

const [executablePath, ...switches] = process.argv.slice(2);
const userDataDir = fs.mkdtempSync('/tmp/bc-pp-');
const opts = { headless: process.env.HEADFUL !== '1', executablePath, userDataDir, args: ['--no-sandbox', ...switches] };
let b = await puppeteer.launch(opts);
await b.setCookie({ name: 'session_login', value: 'x', domain: 'example.com', path: '/', secure: true });
await b.close();
if (process.env.CLEAR_SESSIONS) fs.rmSync(path.join(userDataDir, 'Default', 'Sessions'), { recursive: true, force: true });
b = await puppeteer.launch(opts);
const cookies = (await b.cookies()).map((c) => c.name);
console.log(JSON.stringify({ switches, clear: Boolean(process.env.CLEAR_SESSIONS), cookies, pages: (await b.pages()).length }));
await b.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
