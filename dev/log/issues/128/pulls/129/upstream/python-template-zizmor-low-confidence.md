## `min-confidence: medium` hides 22 template-injection findings in `release.yml`, and secretlint runs at whatever version npm serves

### Summary

The `Audit Workflows` job runs `zizmorcore/zizmor-action` with `min-confidence: medium`. zizmor reports `template-injection` on step outputs at **Low** confidence, and `artipacked` at Low as well, so the floor hides every finding of both kinds. At template HEAD `1e2f475`, `release.yml` has **22** of them. The job reports "No findings" for all of them.

The JS template fixed the same floor in js#160 and js#179 and now runs at `low`. The Python template never got that fix.

A related supply-chain gap: `release.yml:197` runs `npx --yes -p secretlint -p @secretlint/secretlint-rule-preset-recommend secretlint "**/*"` with no versions. Each run installs whatever is newest on npm, so the scanner can change behaviour, or be replaced, without a diff in this repository.

Found while auditing link-foundation/browser-commander#128, which uses this template's pipeline.

### Reproduction

```console
$ git clone --depth 1 https://github.com/link-foundation/python-ai-driven-development-pipeline-template t && cd t
$ pipx run zizmor==1.30.1 --config .github/zizmor.yml --min-confidence medium --no-online-audits .github/workflows
No findings to report. Good job! (22 ignored, 20 suppressed)
$ pipx run zizmor==1.30.1 --config .github/zizmor.yml --min-confidence low --no-online-audits .github/workflows
...
42 findings (20 suppressed, 22 unsafe fixes): 22 informational, 0 low, 0 medium, 0 high
```

The 22 interpolations, all in `.github/workflows/release.yml`:

| Expression | Count | Example |
| --- | --- | --- |
| `${{ steps.python_layout.outputs.root }}` | 19 | line 94: `run: python "${{ steps.python_layout.outputs.root }}/scripts/detect_code_changes.py"` |
| `${{ steps.python_layout.outputs.multi_language }}` | 1 | |
| `${{ steps.version_check.outputs.current_version }}` | 1 | |
| `${{ steps.version.outputs.new_version }}` | 1 | |

Lines: 94, 163, 173, 178, 183, 188, 195, 326, 338, 417, 422, 487, 633, 644, 675, 684, 759, 774, 782, 788, 801, 810.

Today these outputs come from the repository's own files, so none is attacker-controlled. The problem is that the audit can no longer tell you when one becomes attacker-controlled. Any new `${{ steps.*.outputs.* }}` in a `run:` block passes silently.

### Suggested fix

1. Pass each value through `env:` and reference it as a shell variable, for example:

   ```yaml
   - name: Detect changes
     env:
       PYTHON_ROOT: ${{ steps.python_layout.outputs.root }}
     run: python "$PYTHON_ROOT/scripts/detect_code_changes.py"
   ```

2. Set `min-confidence: low` in `workflows.yml`, as the JS template does.
3. Pin the analyser in one place. `zizmor-action@v0.6.2` can only install versions in its own digest table, which ends at 1.29.0, and its `latest` is that table's entry. Bump to `zizmor-action@v0.6.4`, whose table goes to 1.30.1, and use the same `version:` in the action, in the `pipx run zizmor==` pedantic pass and in the reproduce comment. The comment still says `--min-confidence medium`.
4. Pin secretlint and its preset to the same version:

   ```yaml
   run: npx --yes -p secretlint@13.0.7 -p @secretlint/secretlint-rule-preset-recommend@13.0.7 secretlint "**/*"
   ```

browser-commander applies all four in link-foundation/browser-commander#129. Its `scripts/check-ci-workflows.mjs` rejects `npx -p <package>` without `@<version>`, and `js/tests/unit/scripts/zizmor-version.test.js` keeps the three zizmor versions equal and inside the action's table.

### Workaround

Until the floor is lowered, run `pipx run zizmor==1.30.1 --config .github/zizmor.yml --min-confidence low .github/workflows` locally before merging workflow changes.
