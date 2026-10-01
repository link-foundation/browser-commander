// Issue #112: cargo warns "`cargo publish --token` is deprecated". Assert the
// publish script never builds that flag again.
import { readFileSync } from 'node:fs';
const src = readFileSync(
  new URL('../rust/scripts/publish-crate.mjs', import.meta.url),
  'utf8'
);
const code = src
  .split('\n')
  .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
  .join('\n');
if (/cargo publish --token/.test(code)) {
  console.error('publish-crate.mjs still passes --token to cargo');
  process.exit(1);
}
console.log('ok: token goes through CARGO_REGISTRY_TOKEN');
