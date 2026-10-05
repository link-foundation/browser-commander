import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { repoPath } from '../../helpers/repo.js';
import { ALL_DATA_CLASSES } from '../../../src/browser/migration/index.js';

const { BEGIN_MARKER, END_MARKER, readCapabilities, renderMigrationSupport } =
  await import(
    pathToFileURL(repoPath('scripts/generate-migration-support.mjs'))
  );
it('generates each source/target/class cell and declares unsupported target writers', () => {
  const capabilities = readCapabilities(repoPath('.'));
  assert.deepEqual(ALL_DATA_CLASSES, capabilities.classes);
  const table = renderMigrationSupport(capabilities);
  assert.equal(table.split('\n').length, 11);
  assert.match(table, /safari\s+\| chromium\s+\| seed\s+\| translate/u);
  const doc = readFileSync(
    repoPath('docs/profile-migration.md'),
    'utf8'
  ).replaceAll('\r\n', '\n');
  assert.equal(
    doc
      .slice(
        doc.indexOf(BEGIN_MARKER) + BEGIN_MARKER.length,
        doc.indexOf(END_MARKER)
      )
      .trim(),
    table
  );
});
