// Probe: does command-stream interpolate an array into separate argv entries?
// Determines whether the shared push helper can take a generic argv runner or
// needs one template per command shape.
import { loadCommandStream } from '../scripts/use-module.mjs';
const { $ } = await loadCommandStream();
const args = ['rev-parse', '--abbrev-ref', 'HEAD'];
try {
  const r = await $`git ${args}`;
  console.log('ARRAY-INTERP-OK:', JSON.stringify(String(r.stdout).trim()));
} catch (e) {
  console.log(
    'ARRAY-INTERP-FAIL:',
    e.message,
    '| stderr:',
    String(e.stderr || '').trim()
  );
}
