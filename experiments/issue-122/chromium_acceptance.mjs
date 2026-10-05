// Accept translated Safari bookmarks/history in a real Chromium profile.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { migrateProfile } from '../../js/src/browser/migration/index.js';

const require = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const { chromium } = require('playwright');
const Database = require('better-sqlite3');
const fixture = fileURLToPath(
  new URL('../../tests/fixtures/safari-data/', import.meta.url)
);
const root = await mkdtemp(path.join(os.tmpdir(), 'bc-safari-acceptance-'));
try {
  const source = path.join(root, 'safari');
  const userDataDir = path.join(root, 'chromium');
  const target = path.join(userDataDir, 'Default');
  await mkdir(source);
  await copyFile(
    path.join(fixture, 'Bookmarks-binary.plist'),
    path.join(source, 'Bookmarks.plist')
  );
  await copyFile(
    path.join(fixture, 'History.db'),
    path.join(source, 'History.db')
  );
  const report = await migrateProfile({
    from: { browser: 'safari', userDataDir: source },
    to: target,
    include: ['bookmarks', 'history'],
    domains: ['github.com'],
    platform: 'darwin',
  });
  assert.equal(report.migrated.bookmarks, 2);
  assert.equal(report.migrated.history, 2);
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
  const bookmarks = JSON.parse(
    await readFile(path.join(target, 'Bookmarks'), 'utf8')
  );
  assert.equal(
    bookmarks.roots.other.children[0].children[0].url,
    'https://github.com/link-foundation'
  );
  assert.equal(
    bookmarks.roots.other.children[1].children[0].url,
    'https://example.org/read'
  );
  const db = new Database(path.join(target, 'History'), { readonly: true });
  try {
    assert.equal(
      db
        .prepare(
          "SELECT count(*) AS n FROM visits JOIN urls ON visits.url=urls.id WHERE urls.url='https://github.com/one'"
        )
        .get().n,
      2
    );
  } finally {
    db.close();
  }
  console.log(
    'Chromium retained translated Safari bookmarks and both matching history visits.'
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
