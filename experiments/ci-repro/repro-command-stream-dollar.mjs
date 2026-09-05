#!/usr/bin/env node
/**
 * Minimal reproduction for the CI failure "$ is not a function".
 *
 * Both js/scripts/setup-npm.mjs and rust/scripts/version-and-commit.mjs do:
 *   const { $ } = await use('command-stream');
 * and then call $`...`. In CI that threw `TypeError: $ is not a function`.
 *
 * This script reports exactly what use-m hands back so the shape can be
 * inspected instead of guessed at.
 */
const { use } = eval(
  await (await fetch('https://unpkg.com/use-m/use.js')).text()
);

const spec = process.argv[2] || 'command-stream';
const mod = await use(spec);

console.log('spec              :', spec);
console.log('typeof module     :', typeof mod);
console.log('module keys       :', Object.keys(mod).length);
console.log('typeof module.$   :', typeof mod.$);
console.log('typeof default.$  :', typeof (mod.default && mod.default.$));

const { $ } = mod;
if (typeof $ !== 'function') {
  console.log('RESULT: REPRODUCED - $ is not a function');
  process.exit(2);
}
const r = await $`echo repro-ok`.run({ capture: true });
console.log('RESULT: OK ->', JSON.stringify(r.stdout));
