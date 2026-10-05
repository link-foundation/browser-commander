// Verify that real Chromium retains translated Firefox visits after launch.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { migrateProfile } from '../../js/src/browser/migration/index.js';

const require = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const { chromium } = require('playwright');
const Database = require('better-sqlite3');
const schema = await readFile(
  new URL('../../tests/fixtures/firefox-history.sql', import.meta.url),
  'utf8'
);
const root = await mkdtemp(
  path.join(os.tmpdir(), 'bc-firefox-history-acceptance-')
);
try {
  const source = path.join(root, 'firefox');
  const userDataDir = path.join(root, 'chromium');
  const target = path.join(userDataDir, 'Default');
  await mkdir(source);
  const filename = path.join(source, 'places.sqlite');
  const sourceDb = new Database(filename);
  sourceDb.exec(schema);
  sourceDb.close();
  const before = await readFile(filename);
  const report = await migrateProfile({
    from: { browser: 'firefox', userDataDir: source },
    to: target,
    include: ['history'],
    domains: ['github.com'],
  });
  assert.equal(report.migrated.history, 3);
  assert.deepEqual(report.skipped, []);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: ['--no-sandbox'],
    executablePath: process.env.BROWSER_COMMANDER_CHROMIUM_EXECUTABLE,
  });
  try {
    const page = await context.newPage();
    await page.goto('about:blank');
  } finally {
    await context.close();
  }
  const db = new Database(path.join(target, 'History'), { readonly: true });
  try {
    const rows = db
      .prepare('SELECT url,title,visit_count FROM urls ORDER BY url')
      .all();
    assert.deepEqual(rows, [
      { url: 'https://docs.github.com/second', title: '', visit_count: 1 },
      { url: 'https://github.com/first', title: 'First Ω', visit_count: 2 },
    ]);
    const times = db
      .prepare('SELECT visit_time FROM visits ORDER BY visit_time')
      .safeIntegers()
      .all();
    assert.deepEqual(
      times.map(({ visit_time }) => visit_time),
      [13344473600000001n, 13344473600000002n, 13344473600000003n]
    );
  } finally {
    db.close();
  }
  assert.deepEqual(await readFile(filename), before);
  console.log(
    'Chromium retained all three matching Firefox visits with exact microsecond timestamps; source bytes are unchanged.'
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
