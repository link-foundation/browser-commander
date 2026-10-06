// Issue #128: narrows down where the stray "Command failed with exit code 7"
// comes from. Compares the virtual `exit` builtin with a real process, with
// mirroring on and off, and `exit 0` under `set -e`.
//
//   node experiments/issue-128/command-stream-exit-variants.mjs
import { loadCommandStream } from '../../scripts/use-module.mjs';

const { $, set, unset } = await loadCommandStream();

async function probe(label, run) {
  process.stderr.write(`\n[${label}] stderr begins >>>`);
  try {
    const r = await run();
    console.log(
      `[${label}] resolved code=${r.code} stderr=${JSON.stringify(r.stderr)}`
    );
  } catch (error) {
    console.log(
      `[${label}] rejected code=${error.code} stderr=${JSON.stringify(error.result?.stderr ?? error.stderr)}`
    );
  }
  process.stderr.write(`<<< [${label}] stderr ends\n`);
}

await probe('virtual exit 7, mirror default', () => $`exit 7`);
await probe('virtual exit 7, mirror false', () => $({ mirror: false })`exit 7`);
await probe('real sh -c "exit 7"', () => $`sh -c "exit 7"`);
set('e');
await probe('virtual exit 0 under set -e', () => $`exit 0`);
unset('e');
await probe('virtual exit 0', () => $`exit 0`);
