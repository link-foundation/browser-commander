// Compare the vendored protocol spec with the validator schemes bundled in the
// installed playwright-core (the driver the Rust engine talks to).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const { loadSpec, pascalCase } =
  await import('../../scripts/generate-playwright-protocol.mjs');
const spec = loadSpec();
const bundle = readFileSync(
  require
    .resolve('playwright-core/package.json')
    .replace(/package\.json$/, 'lib/coreBundle.js'),
  'utf8'
);
const driver = new Set(
  [...bundle.matchAll(/scheme\.(\w+) = /g)].map((m) => m[1])
);
const expected = new Set();
for (const [name, def] of Object.entries(spec)) {
  if (def.type !== 'interface') {
    continue;
  }
  for (const cmd of Object.keys(def.commands ?? {})) {
    expected.add(`${name}${pascalCase(cmd)}Params`);
  }
  for (const ev of Object.keys(def.events ?? {})) {
    expected.add(`${name}${pascalCase(ev)}Event`);
  }
}
const missingInDriver = [...expected].filter((x) => !driver.has(x));
const driverOnly = [...driver].filter(
  (x) => /(Params|Event)$/.test(x) && !expected.has(x)
);
console.log({
  expected: expected.size,
  driverSchemes: driver.size,
  missingInDriver,
  driverOnly: driverOnly.slice(0, 40),
  driverOnlyCount: driverOnly.length,
});
