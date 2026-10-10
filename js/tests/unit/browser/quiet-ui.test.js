import { it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRestrictions } from '../../../src/browser/restrictions.js';

it('quiet-ui merges caller features and disables Translate in preferences', () => {
  const result = resolveRestrictions(['quiet-ui'], {
    disableFeatures: ['CustomFeature', 'Translate'],
  });
  const switches = result.args.filter((arg) =>
    arg.startsWith('--disable-features=')
  );
  assert.equal(switches.length, 1);
  assert.ok(switches[0].includes('SessionRestoreInfobar'));
  assert.ok(switches[0].includes('CustomFeature'));
  assert.equal(result.preferences.translate.enabled, false);
});
