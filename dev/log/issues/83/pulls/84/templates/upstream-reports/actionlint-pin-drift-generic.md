# `actionlint` is pinned to 1.7.7: real runner labels are reported as unknown, and a path filter that never matches is not reported

The workflow linter is the one job whose whole purpose is to notice mistakes in
the workflows. Pinned at `1.7.7` it currently does both halves of the job
wrong: it reports two GitHub-hosted runner labels that exist as unknown, and it
stays quiet about a path filter that silently matches nothing.

`docker://rhysd/actionlint:1.7.7` is used in `.github/workflows/workflows.yml`.
The practice document this template is built from
([CI-CD-BEST-PRACTICES.md, principle 14](https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md))
already names `docker://rhysd/actionlint:1.7.12`.

## Reproduction

```bash
WORKDIR="$(mktemp -d)"
# mktemp -d creates the directory 0700, which the unprivileged user inside the
# actionlint image cannot traverse; the linter then reports "no project was
# found" rather than a permission error.
chmod 755 "$WORKDIR"
mkdir -p "$WORKDIR/.github/workflows"
git init -q "$WORKDIR"

cat > "$WORKDIR/.github/workflows/probe.yml" <<'YML'
name: Probe
on:
  push:
    paths:
      - ./src/**
jobs:
  build:
    runs-on: macos-15-intel
    steps:
      - run: echo hi
  build-arm:
    runs-on: windows-11-arm
    steps:
      - run: echo hi
YML

for version in 1.7.7 1.7.12; do
  echo "=== actionlint ${version} ==="
  docker run --rm -v "${WORKDIR}:/repo" -w /repo "rhysd/actionlint:${version}" -no-color || true
done
```

### 1.7.7 — two false positives, one false negative

```
.github/workflows/probe.yml:8:14: label "macos-15-intel" is unknown. available labels are ... [runner-label]
.github/workflows/probe.yml:12:14: label "windows-11-arm" is unknown. available labels are ... [runner-label]
```

Both labels are real GitHub-hosted runners. Nothing at all is said about
`./src/**`.

### 1.7.12 — no false positives, and the real bug

```
.github/workflows/probe.yml:5:9: '.' and '..' are not allowed in glob path. note: filter pattern
  syntax is explained at https://docs.github.com/... [glob]
```

`./src/**` never matches any file, so a workflow filtered that way stops
running and reports nothing — a check that quietly does nothing is the hardest
kind of failure to notice. actionlint gained that check in
[1.7.11](https://github.com/rhysd/actionlint/releases/tag/v1.7.11) (#521).

## Why this matters here

No workflow in this repository uses one of the labels 1.7.7 rejects today, so
the false positives are latent rather than active — but the missing `glob`
check is live: a `paths:` filter written as `./src/**` would silently stop the
workflow from ever running, and the job that exists to catch that would stay
green. (The Rust template already hits the false-positive half:
`link-foundation/rust-ai-driven-development-pipeline-template#160`, where the
workaround is a repository-wide label whitelist that also suppresses future
typos.)

## Suggested fix

1. In `.github/workflows/workflows.yml`, change the pin (both the `uses:` and
   the local-reproduction comment beside it):

   ```diff
   -      #   docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7 -color
   -      - uses: docker://rhysd/actionlint:1.7.7
   +      #   docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.12 -color
   +      - uses: docker://rhysd/actionlint:1.7.12
   ```

2. Run the image once against the tree before merging. Five releases of new
   checks can arrive with a backlog; if any of them fires, fix or scope it
   rather than re-adding a blanket suppression.

Verified in `link-foundation/browser-commander` first: `1.7.12` exits 0 with no
findings there, so for a tree that is already clean this is a pure gain.

## Workaround

None for the missing `glob` check: it does not exist in 1.7.7, so nothing short
of the newer image reports it. A `.github/actionlint.yaml` whitelist covers the
runner-label false positives, at the cost of suppressing the same check for
every other label in the repository.
