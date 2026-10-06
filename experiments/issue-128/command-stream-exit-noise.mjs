// Issue #128: the JS test logs end with a stray "Command failed with exit
// code 7" printed after node:test's summary. This reproduces it outside the
// test runner: the rejected `$` is caught, yet the message still appears.
//
//   node experiments/issue-128/command-stream-exit-noise.mjs
import { loadCommandStream } from '../../scripts/use-module.mjs';

const { $ } = await loadCommandStream();

try {
  await $`exit 7`;
  console.log('resolved (unexpected)');
} catch (error) {
  console.log(`caught: code=${error.code} message=${error.message}`);
}

process.on('exit', (code) => console.log(`process exit ${code}`));
console.log('script body finished');
