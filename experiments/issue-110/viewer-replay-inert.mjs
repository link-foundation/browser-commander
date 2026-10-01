// Is the offline viewer's replay path inert for hostile recorded HTML?
//
// CodeQL reports js/xss-through-dom where the viewer parses a checkpoint's
// recorded HTML with DOMParser to replay mutations. This records a bundle whose
// snapshot, replayed mutation and title all carry script, opens its viewer in
// Chromium, steps through the replay, and reports whether any of it ran.
//
// With the viewer from d507e40 (before recorded text was escaped) the hostile
// url and title ran; since f3156c4 nothing runs, including the replayed
// mutation, because DOMParser output only reaches the sandboxed stage frame.
//
// Usage (from js/): node ../experiments/issue-110/viewer-replay-inert.mjs
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { startTrace } from '../../js/src/traces/recorder.js';
import { TRACE_MODE } from '../../js/src/traces/schema.js';
import { writeTraceViewer } from '../../js/src/traces/viewer.js';
import {
  createFakeCommander,
  createFakePage,
  makeSnapshot,
} from '../../js/tests/helpers/trace-fixtures.js';

// playwright is a dev dependency of the JavaScript package, not of experiments/.
const { chromium } = createRequire(
  new URL('../../js/package.json', import.meta.url)
)('playwright');

const hostile = (tag) =>
  `<img src=x onerror="top.ran=(top.ran||[]).concat('${tag}')">` +
  `<script>top.ran=(top.ran||[]).concat('${tag}-script')</script>`;

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'viewer-inert-'));
const page = createFakePage({
  snapshot: makeSnapshot({
    html: `<!DOCTYPE html><html><body><ul id="list"></ul>${hostile('snapshot')}</body></html>`,
    state: { title: hostile('title'), url: hostile('url') },
  }),
});
const trace = await startTrace({
  commander: createFakeCommander(page),
  page,
  output: path.join(dir, 'run.bc-trace'),
  mode: TRACE_MODE.CONTINUOUS,
  screenshots: false,
  initialCheckpoint: false,
});
await trace.checkpoint('first');
page.queueMutations([
  {
    sequence: 1,
    mainFrame: true,
    records: [
      {
        kind: 'childList',
        target: { path: '#list' },
        added: [
          {
            type: 'element',
            index: 0,
            html: `<li>${hostile('mutation')}</li>`,
          },
        ],
        removed: [],
      },
    ],
  },
]);
await trace.checkpoint('second');
const stopped = await trace.stop();
const viewer = await writeTraceViewer(stopped.path);

// CHROME_PATH picks a browser when Playwright's own build is not installed.
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
});
try {
  const tab = await browser.newPage();
  await tab.goto(`file://${viewer}`);
  // Select the first checkpoint, whose interval holds the mutation, and replay it.
  await tab.evaluate(() =>
    [...document.querySelectorAll('#timeline li')]
      .find((li) => li.querySelector('.what').textContent === 'first')
      .click()
  );
  await tab.click('#step-forward');
  await tab.waitForTimeout(500);
  const framed = await tab.getAttribute('#stage', 'srcdoc');
  const ran = await tab.evaluate(() => window.ran || []);
  console.log(
    JSON.stringify({
      replayedMutation: framed.includes('mutation'),
      step: await tab.textContent('#step'),
      titleShownEscaped: (await tab.innerHTML('#details')).includes('&lt;img'),
      ran,
    })
  );
  process.exitCode = ran.length ? 1 : 0;
} finally {
  await browser.close();
  await fs.rm(dir, { recursive: true, force: true });
}
