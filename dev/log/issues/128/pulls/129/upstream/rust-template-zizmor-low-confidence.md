## `min-confidence: medium` hides 12 zizmor findings in `release.yml`, two of them implicit credential persistence, and secretlint is unpinned

### Summary

The `Zizmor` job runs `zizmorcore/zizmor-action` with `min-confidence: medium`. zizmor reports both `artipacked` and `template-injection` at **Low** confidence, so the floor hides all of them. At template HEAD `e7d4a5b`, `release.yml` has **12** hidden findings. The job says "No findings".

The JS template fixed the same floor in js#160 and js#179 and now runs at `low`. The Rust template never got that fix.

Separately, `release.yml:241` runs `npx --yes -p secretlint -p @secretlint/secretlint-rule-preset-recommend secretlint ...` with no versions, so each run installs whatever is newest on npm.

Found while auditing link-foundation/browser-commander#128, which uses this template's pipeline.

### Reproduction

```console
$ git clone --depth 1 https://github.com/link-foundation/rust-ai-driven-development-pipeline-template t && cd t
$ pipx run zizmor==1.30.1 --config .github/zizmor.yml --min-confidence medium --no-online-audits .github/workflows
No findings to report. Good job! (14 ignored, 46 suppressed)
$ pipx run zizmor==1.30.1 --config .github/zizmor.yml --min-confidence low --no-online-audits .github/workflows
...
60 findings (2 ignored, 46 suppressed, 11 unsafe fixes): 10 informational, 2 low, 0 medium, 0 high
```

| Audit | Location | What |
| --- | --- | --- |
| artipacked | `release.yml:754` | checkout with no `persist-credentials` (auto-release, pushes) |
| artipacked | `release.yml:918` | checkout with no `persist-credentials` (manual-release, pushes) |
| template-injection | `release.yml:788, 861, 863, 879, 1012, 1079` | `steps.version.outputs.new_version`, `steps.bump_type.outputs.bump_type`, `steps.release-metadata.outputs.version`, `steps.build.outputs.digest`, ... inside `run: \|` blocks |
| template-injection | `release.yml:817, 967` | `rust-script scripts/wait-for-crate.rs --release-version "${{ ... }}"` |
| template-injection | `release.yml:825, 974` | `rust-script scripts/smoke-test-published-crate.rs --release-version "${{ ... }}"` |

The two checkouts *should* keep the token, because those jobs push the version commit. The comment above each says so. But the code leaves the token implicitly, and zizmor cannot tell an intended write from a forgotten `persist-credentials: false`. At `medium`, a third checkout that forgets the setting would pass just as silently.

### Suggested fix

1. Make the intent explicit on the two writer checkouts, which also clears `artipacked`:

   ```yaml
   - uses: actions/checkout@v6
     with:
       fetch-depth: 0
       token: ${{ secrets.GITHUB_TOKEN }}
       # The release pushes its version commit and tag with this token.
       persist-credentials: true
   ```

2. Move each `${{ steps.*.outputs.* }}` in a `run:` into `env:`. For example, `--release-version "$RELEASE_VERSION"` with `env: RELEASE_VERSION: ${{ steps.version.outputs.new_version }}`.
3. Set `min-confidence: low`. Bump `zizmor-action` to `v0.6.4`, the first release whose digest table includes 1.30.1; v0.6.2 dies with `Unknown version` for anything after 1.29.0. Use the same version in the pedantic `pipx run` step and in the reproduce comment.
4. Pin secretlint: `npx --yes -p secretlint@13.0.7 -p @secretlint/secretlint-rule-preset-recommend@13.0.7 secretlint ...`.

browser-commander applies these in link-foundation/browser-commander#129. A policy check in `scripts/check-ci-workflows.mjs` also allows `persist-credentials: true` only in jobs in the main-writer concurrency group.

### Workaround

Run `pipx run zizmor==1.30.1 --config .github/zizmor.yml --min-confidence low .github/workflows` locally before merging workflow changes.
