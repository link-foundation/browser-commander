## The zizmor job runs two different zizmor versions (1.29.0 and 1.30.0), and secretlint is installed at whatever version npm serves

Found while auditing link-foundation/browser-commander#128 against template HEAD `4c8644f`.

### 1. Two analysers in one job

`.github/workflows/workflows.yml`, job `zizmor`:

| Where | Version |
| --- | --- |
| `zizmorcore/zizmor-action@v0.6.2` with `version: 1.29.0` (line 116) | 1.29.0 |
| reproduce comment: `pipx run zizmor==1.29.0 ...` (line 103) | 1.29.0 |
| "Audit for pedantic-only high-severity findings": `pipx run zizmor==1.30.0 ...` (line 130) | **1.30.0** |

The two passes in one job disagree about which audits exist. 1.30.0 added the `self-repository` audit (see #155). A finding from the pedantic pass cannot be reproduced with the command the comment documents.

The split is probably forced. `zizmor-action@v0.6.2` resolves `version:` against its own `support/versions` digest table, which ends at 1.29.0, and `action.sh` dies with `Unknown version` for anything newer. So the action pass could not follow when the `pipx` pass moved to 1.30.0.

Fix: bump the action to `zizmorcore/zizmor-action@v0.6.4`, whose table includes `1.30.0` and `1.30.1`. Then set one version in all three places. A cheap test pins this: parse the workflow, assert that every `zizmor==X` equals the action's `version:`, and assert that the version is not newer than the newest entry known for that action tag. browser-commander's test is `js/tests/unit/scripts/zizmor-version.test.js` in link-foundation/browser-commander#129.

```console
$ for t in v0.6.2 v0.6.4; do curl -sL https://raw.githubusercontent.com/zizmorcore/zizmor-action/$t/support/versions | tail -1; done
1.29.0 sha256:863026d5...
1.30.1 sha256:a2eb396d...
```

### 2. Unpinned secretlint

`release.yml:261`:

```yaml
run: npx --yes -p secretlint -p @secretlint/secretlint-rule-preset-recommend secretlint "**/*"
```

There are no versions, so every run installs the newest `secretlint` and preset. Rules can change and the job can go red or quiet without any change here. A compromised publish also runs in CI with the job's token in scope. The Python (`release.yml:197`) and Rust (`release.yml:241`) templates have the same line.

Fix: pin both packages to the same version:

```yaml
run: npx --yes -p secretlint@13.0.7 -p @secretlint/secretlint-rule-preset-recommend@13.0.7 secretlint "**/*"
```

To keep it pinned, add a policy check that rejects `npx -p <package>` without `@<version>`. browser-commander uses the pattern `/^[^#]*\bnpx\b.*\s(?:-p|--package)[ =](?:@[^/\s]+\/)?[^@\s]+(?=\s|$)/` in `scripts/check-ci-workflows.mjs`.

Before pinning, it is worth confirming the step really scans. With secretlint 13.0.7 and the preset, a planted GitHub token and a planted Slack token both fail the step with exit 1, and a clean tree exits 0 with no output. So the silence on green runs is real scanning, not a no-op.

### Workaround

Pin locally as above. Until the action is bumped, run the pedantic pass at `zizmor==1.29.0`.
