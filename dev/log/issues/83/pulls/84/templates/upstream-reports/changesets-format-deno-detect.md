# @changesets/format: the `{ file: "deno.json", key: "fmt" }` config check is unreachable

**Title:** `detect()` picks `deno` for any project that merely has a `deno.json`, and `deno` is the one formatter with no local fallback

## Summary

`deno`'s `configFiles` list contains both a bare filename and the precise key check for the same file ([`src/formatters.ts:102`](https://github.com/changesets/format/blob/main/src/formatters.ts#L102)):

```ts
const deno: Formatter = {
  name: "deno",
  // https://docs.deno.com/runtime/reference/cli/fmt/#configuring-the-formatter
  configFiles: ["deno.json", "deno.jsonc", { file: "deno.json", key: "fmt" }],
  ...
};
```

`detect()` iterates that array in order and returns on the first hit ([`src/detect.ts`](https://github.com/changesets/format/blob/main/src/detect.ts)), so the bare `"deno.json"` always matches before the `{ file: "deno.json", key: "fmt" }` entry is reached. The third entry is dead code: no `deno.json` can ever reach it, and the linked documentation says the `fmt` key is exactly what configures `deno fmt`.

The consequence is that the mere **existence** of a `deno.json` — for any reason, including one that says nothing about formatting — selects the deno formatter. `deno` is second in `defaultDetectOrder` and `prettier` is last, so it wins over a prettier the project actually depends on.

That would be a harmless mis-detection for any other entry in the table. It is not harmless for `deno`, because `deno` is the **only** formatter with no `packageName`:

| Formatter                              | How it is invoked                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `prettier`, `biome`, `oxfmt`, `dprint` | `packageManagerExecute(...)` → `resolveCommand(pm, "execute-local", …)`, falling back to `npx` — resolves out of `node_modules` |
| `deno`                                 | `spawnProcess("deno", ["fmt", …])` — straight off `PATH`, no existence check, no fallback                                       |

So on any machine without Deno installed — which includes GitHub's `ubuntu-latest`, `macos-latest` and `windows-latest` runners — the result is an unconditional `spawn deno ENOENT`.

## Reproducible example

```js
// probe.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detect } from '@changesets/format';

const root = mkdtempSync(join(tmpdir(), 'fmt-'));
const fixture = (name, files) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c);
  return detect({ cwd: dir, stopDir: dir });
};

console.log(
  'prettier only          ->',
  await fixture('a', { '.prettierrc': '{}' })
);
console.log(
  'deno.json, no fmt key  ->',
  await fixture('b', {
    'deno.json': JSON.stringify({ nodeModulesDir: 'auto' }),
    '.prettierrc': '{}',
  })
);
console.log(
  'deno.json with fmt key ->',
  await fixture('c', {
    'deno.json': JSON.stringify({ fmt: { lineWidth: 80 } }),
    '.prettierrc': '{}',
  })
);
```

```console
$ node probe.mjs        # @changesets/format@0.1.2
prettier only          -> prettier
deno.json, no fmt key  -> deno      <-- expected prettier
deno.json with fmt key -> deno
```

Fixture **b** is the defect: a `deno.json` that configures only `nodeModulesDir` selects the deno formatter over the prettier that is installed and configured. Fixtures **a** and **c** show the intended behaviour is otherwise reachable — which is why the bare string is the thing to remove, not the key check.

Note also that `detect()` uses `traverseUpwards`, so a `deno.json` in any **parent** directory selects deno for a nested package. In a monorepo one unrelated Deno subproject changes the formatter for everything beside it.

## How this reached production

`link-foundation/browser-commander` had a `js/deno.json` containing exactly fixture **b**'s content — orphaned configuration, referenced by no workflow, no npm script and no document — beside a `.prettierrc` and an installed `prettier`. After `@changesets/cli` moved to v3, run [33974450016](https://github.com/link-foundation/browser-commander/actions/runs/33974450016) had `changeset version` die with `spawn deno ENOENT` from inside `applyReleasePlan`, **after** bumping `package.json` and writing `CHANGELOG.md` and **before** deleting the changeset it had just consumed. The half-applied state landed on the default branch: a changeset queued to be released a second time, and a `CHANGELOG.md` with trailing whitespace that then failed the repository's `prettier --check` on an unrelated contributor's pull request.

Deleting `deno.json` fixed it, and pinning `"format": "prettier"` in `.changeset/config.json` keeps it fixed. Neither is discoverable from the error message, which names only `deno`.

## Suggestions for fixing this in code

**1. Drop the bare filenames from `deno.configFiles`, keeping only the key check.** This is the one-line version, and it makes the entry that is already written do what it says:

```ts
configFiles: [
  { file: "deno.json", key: "fmt" },
  { file: "deno.jsonc", key: "fmt" },
],
```

`checkConfigFileWithKeyExists` currently uses `JSON.parse`, which rejects a `.jsonc` with comments, so covering `deno.jsonc` properly needs a comment-tolerant parse (`jsonc-parser`, or the `strip-json-comments` already common in this ecosystem). If that is not wanted, keeping `"deno.jsonc"` as a bare string while making `deno.json` key-checked would still fix the common case.

**2. Make `deno` fall through when it is not on `PATH`.** Detection currently commits to a formatter that may not be runnable. Since `deno` cannot be resolved from `node_modules`, an existence check is the equivalent of the `packageName`/`node_modules` fallback the other four already get:

```ts
const deno: Formatter = {
  name: "deno",
  isAvailable: () => which("deno") !== undefined,   // or `spawnSync("deno", ["--version"])`
  ...
};
```

with `detect()` skipping a formatter whose `isAvailable` returns false. Failing that, a clearer error at the call site — "detected the deno formatter from `<path>/deno.json`, but `deno` is not on PATH; set `format` in `.changeset/config.json`" — would have turned the incident above into a five-minute fix instead of an afternoon.

**3. Consider whether `deno` should outrank `prettier` at all when both are configured.** The current order means a project that has both a `deno.json` and a `.prettierrc` gets deno regardless of which one is actually installed. The `node_modules` traversal that already exists as a fallback would be a reasonable tiebreak in the primary pass too.

## Environment

- `@changesets/format@0.1.2`, and `src/formatters.ts` on `main` at the time of writing carries the same list
- reproduced on Node v20.20.2 and v24.20.0, Linux
- downstream: `@changesets/cli@^3.0.2`

## Context

Found while auditing CI/CD false positives, false negatives, warnings and errors in `link-foundation/browser-commander` ([issue #83](https://github.com/link-foundation/browser-commander/issues/83), [PR #84](https://github.com/link-foundation/browser-commander/pull/84)). The probe above is kept runnable there as `experiments/ci-repro/repro-changesets-format-detect.mjs`.
