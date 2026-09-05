# Comment added to js#154

Filed as a comment rather than a new issue: js#154 already covers "`changeset version` will
spawn a deno command after the changesets 3.x upgrade". The mechanism it names is not the
one that actually fires in this repository's tree, and the workaround it proposes does not
prevent it, so the comment supplies both.

---

This is no longer hypothetical downstream — it fired in `link-foundation/browser-commander` on 2026-09-05, run [33974450016](https://github.com/link-foundation/browser-commander/actions/runs/33974450016). Two corrections from that, because the mechanism turned out not to be the one described above, and the proposed workaround does not prevent it.

### `deno.json` is the trigger, not `deno.lock` — and `package-manager-detector` is not involved

Under changesets 3.x, the formatter is chosen by `@changesets/format`'s **own** `detect()`, which has nothing to do with `package-manager-detector`. It walks `defaultDetectOrder` — `dprint, deno, oxfmt, biome, prettier` — and returns the first formatter whose config file exists. `deno`'s list is (`@changesets/format@0.1.2`, and the same on `main`):

```ts
configFiles: ["deno.json", "deno.jsonc", { file: "deno.json", key: "fmt" }],
```

The bare `"deno.json"` matches on existence alone, so the `{ file, key: "fmt" }` entry after it is unreachable. Measured against this repository's tree, at `338fafa`:

```js
import { detect } from '@changesets/format';
await detect({ cwd: '/path/to/js-ai-driven-development-pipeline-template' });
// => 'deno'
```

And the formatter selected that way is not `<agent> x prettier`. `deno` is the one entry in the table with no `packageName`, so it never calls `getPackageManager()` at all:

```ts
async format(files, ctx) {
  await spawnProcess("deno", ["fmt", "--permit-no-files", ...files], ctx.cwd);
}
```

`deno` is spawned straight off `PATH` — hence `spawn deno ENOENT`, with no `npx`/`node_modules` fallback and no existence check.

### `devEngines.packageManager` will not fix this repository

That field is the right fix for the `deno.lock` → `package-manager-detector` path, and worth having. But it is only consulted by the _prettier / biome / oxfmt / dprint_ branches, via `ctx.getPackageManager()`. As long as `deno.json` sits at the root, `detect()` returns `deno` and none of those branches is reached, so the declaration is never read. Adding it and stopping there would leave the release broken while looking fixed — which is a worse state than now.

### What actually fixed it downstream

Two changes, both cheap:

1. **Deleted `deno.json`.** It was orphaned — no workflow, no npm script and no document referenced it. Same question applies here: `deno.json` and `deno.lock` are both at this repository's root, and neither the `release.yml` versioning job nor anything else installs from them.
2. **Pinned the formatter** in `.changeset/config.json`, so detection cannot pick a binary that is not installed:

   ```json
   {
     "$schema": "https://unpkg.com/@changesets/config@4.0.0/schema.json",
     "format": "prettier"
   }
   ```

   This is the fail-closed half, and it is worth doing regardless of what happens to `deno.json`, since any future config file for any of the five formatters can shift detection again.

A regression test that costs nothing, in case it is useful here too — it asserts the pinned formatter is one this package can actually run, i.e. one with a `packageName` that resolves in `node_modules`:

```js
const { defaultDetectOrder } = require('@changesets/format');
assert.ok(defaultDetectOrder.includes(config.format));
assert.ok(
  config.format !== 'deno',
  'deno is spawned off PATH with no fallback'
);
```

### Cost of finding out the hard way

Because `command-stream`'s `$` resolves rather than rejects on a non-zero exit, the `catch` in `scripts/changeset-version.mjs` never ran, so the crash was reported as `✅ Version bump complete` and the job was green (filed separately). `changeset version` had already bumped `package.json` and written `CHANGELOG.md`, and had not yet deleted the changeset it consumed — visible in the release commit [`8f5f4bb`](https://github.com/link-foundation/browser-commander/commit/8f5f4bb), which bumps the version, appends to the changelog, and still contains the consumed changeset. `0.17.0` shipped to npm, the changeset was queued to be published a second time, and the unformatted `CHANGELOG.md` landed on `main` and failed the next contributor's `prettier --check`.

The `{ file: "deno.json", key: "fmt" }` half is an upstream defect in `@changesets/format` rather than a problem with this template; reported there separately.

Found while auditing CI/CD false positives, false negatives, warnings and errors in `link-foundation/browser-commander` ([issue #83](https://github.com/link-foundation/browser-commander/issues/83), [PR #84](https://github.com/link-foundation/browser-commander/pull/84)).
