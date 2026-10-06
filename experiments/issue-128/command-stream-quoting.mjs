// Issue #128: does command-stream quote interpolated values itself?
// CodeQL (js/incomplete-sanitization) flags js/scripts/version-and-commit.mjs
// for escaping only `"` before interpolating into `git commit -m "${…}"`.
// Run: node experiments/issue-128/command-stream-quoting.mjs
import { loadCommandStream } from '../../scripts/use-module.mjs';

const { $ } = await loadCommandStream();

for (const value of ['0.26.0', 'a "quoted" word', 'back\\slash $HOME `id`']) {
  const bare = await $({ mirror: false })`printf '%s' ${value}`;
  const manual = value.replace(/"/g, '\\"');
  const wrapped = await $({ mirror: false })`printf '%s' "${manual}"`;
  console.log(
    JSON.stringify({
      value,
      bare: bare.stdout,
      bareExact: String(bare.stdout) === value,
      wrapped: wrapped.stdout,
      wrappedExact: String(wrapped.stdout) === value,
    })
  );
}
