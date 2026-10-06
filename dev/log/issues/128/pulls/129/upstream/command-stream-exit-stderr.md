## Virtual `exit N` writes "Command failed with exit code N" to the parent's stderr, and `exit 0` rejects under `set -e`

### Summary

Two problems with the virtual `exit` builtin in command-stream 1.6.2:

1. ``await $`exit 7` `` writes `Command failed with exit code 7` to the parent's `process.stderr`, with no trailing newline. This happens even when the caller catches the rejection. A real shell's `exit 7` writes nothing to stderr, and neither does ``$`sh -c "exit 7"` ``.
2. With errexit on (`set('e')`), ``await $`exit 0` `` **rejects** with `code=0` and `stderr="Command failed with exit code 0"`.

### Where it showed up

browser-commander's Node.js test job ends with a stray line printed after `node:test`'s summary and the passing exit status:

```
ℹ duration_ms 30841.318159
Node.js test suite finished in 32s of its 300s budget (exit 0).
Command failed with exit code 7
```

The line appears on Ubuntu and macOS (run 37509328260, job "Test (Node.js on ubuntu-latest)"). The suite passed, but the log looks like a failure. Its source was a test that asserted ``$`exit 7` `` rejects. See link-foundation/browser-commander#128.

### Reproduction

```js
// npm i command-stream@1.6.2 && node repro.mjs 2>stderr.txt; cat stderr.txt
import { $, set, unset } from 'command-stream';

async function probe(label, run) {
  process.stderr.write(`\n[${label}] >>>`);
  try {
    const r = await run();
    console.log(`[${label}] resolved code=${r.code} stderr=${JSON.stringify(r.stderr)}`);
  } catch (error) {
    console.log(`[${label}] rejected code=${error.code} stderr=${JSON.stringify(error.result?.stderr ?? error.stderr)}`);
  }
  process.stderr.write(`<<<\n`);
}

set('e');
await probe('virtual exit 7, mirror default', () => $`exit 7`);
await probe('virtual exit 7, mirror false', () => $({ mirror: false })`exit 7`);
await probe('real sh -c "exit 7"', () => $`sh -c "exit 7"`);
await probe('virtual exit 0 under set -e', () => $`exit 0`);
unset('e');
await probe('virtual exit 0', () => $`exit 0`);
```

Observed with command-stream 1.6.2 on Linux, Node v26.10.0:

```
--- stdout
[virtual exit 7, mirror default] rejected code=7 stderr="Command failed with exit code 7"
[virtual exit 7, mirror false] rejected code=7 stderr="Command failed with exit code 7"
[real sh -c "exit 7"] rejected code=7 stderr=""
[virtual exit 0 under set -e] rejected code=0 stderr="Command failed with exit code 0"
[virtual exit 0] resolved code=0 stderr=""
--- stderr
[virtual exit 7, mirror default] >>>Command failed with exit code 7<<<
[virtual exit 7, mirror false] >>><<<
[real sh -c "exit 7"] >>><<<
[virtual exit 0 under set -e] >>>Command failed with exit code 0<<<
[virtual exit 0] >>><<<
```

Expected:

- `exit 7`: rejects with `code=7`, `stderr=""`, and nothing mirrored, as `sh -c "exit 7"` does.
- `exit 0` under `set -e`: resolves with `code=0`, as `sh -ec 'exit 0'` does.

### Root cause

`src/commands/$.exit.mjs` reports every exit as an error, including `exit 0` under errexit:

```js
return async function exit({ args }) {
  const code = parseInt(args[0] || 0);
  if (globalShellSettings.errexit || code !== 0) {
    throw createCommandError(`Command failed with exit code ${code}`, { code });
  }
  return { stdout: '', code };
};
```

`handleVirtualError` in `src/$.process-runner-virtual.mjs` then uses the error *message* as the command's stderr and mirrors it:

```js
const result = createResult({
  code: exitCode,
  stdout: error.stdout ?? '',
  stderr: error.stderr ?? error.message,   // <- message becomes stderr
  stdin: '',
});

emitOutput(runner, 'stderr', result.stderr); // <- written to process.stderr when mirror is on
```

The `error.message` fallback suits handlers that fail unexpectedly. It is wrong for `exit`, which is a normal way to set a status and prints nothing in any POSIX shell.

### Suggested fix

In `src/commands/$.exit.mjs`, report the status instead of throwing. The runner's normal non-zero/errexit path then rejects exactly as it does for a real process:

```js
return async function exit({ args }) {
  const code = parseInt(args[0] || 0, 10);
  return { stdout: '', stderr: '', code: Number.isNaN(code) ? 2 : code };
};
```

We patched a local copy this way and reran the repro. All five probes then match `sh`: both `exit 7` cases reject with `stderr=""` and print nothing, and `exit 0` under `set -e` resolves. Under errexit, ``$`exit 3; echo after` `` still rejects with code 3 and never runs `echo`. Without errexit, a non-throwing `exit` would let a `;` sequence keep going, which `sh` does not do.

If `exit` has to keep throwing, for example to stop a `;` sequence, give the error an explicit empty stderr and throw only for non-zero codes:

```js
if (code !== 0) {
  throw createCommandError(`Command failed with exit code ${code}`, { code, stderr: '' });
}
```

The `??` fallback in `handleVirtualError` already honours `stderr: ''`. A regression test can check that ``$`exit 7` `` rejects with `code 7` and `stderr === ''`, that nothing reaches `process.stderr`, and that ``$`exit 0` `` resolves under `set('e')`.

### Workaround

Use a real process when a test needs a failing command. ``$`sh -c "exit 7"` `` rejects with code 7 and prints nothing. browser-commander does this in `js/tests/unit/scripts/command-stream-errexit.test.js` (commit f1c4d1d). Passing `{ mirror: false }` also hides the line, but the bogus stderr stays in the result.
