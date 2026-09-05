#!/usr/bin/env bash
# repro-actionlint-pin-drift.sh
#
# Shows what a workflow linter pinned to actionlint 1.7.7 gets wrong, and what
# 1.7.12 - the version CI-CD-BEST-PRACTICES principle 14 names - gets right.
#
# The probe workflow contains two real GitHub-hosted runner labels and one
# genuinely broken path filter:
#
#   1.7.7   reports both runner labels as unknown   -> two false positives
#           says nothing about `./src/**`           -> one false negative
#   1.7.12  reports `./src/**` as a glob error      -> the real bug, and only it
#
# `./src/**` never matches anything, so a workflow filtered that way silently
# stops running - the failure mode is a check that quietly does nothing, which
# is the hardest kind to notice.
#
# The rust template works around the false positives with a `.github/actionlint.yaml`
# that whitelists the two labels. That file suppresses the entire `runner-label`
# check, including a future typo; upgrading the pin removes the need for it.
#
# Usage: bash experiments/ci-repro/repro-actionlint-pin-drift.sh

set -euo pipefail

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# mktemp -d creates the directory 0700, which the unprivileged user inside the
# actionlint image cannot traverse; the linter then reports "no project was
# found" rather than a permission error.
chmod 755 "$WORKDIR"
mkdir -p "$WORKDIR/.github/workflows"
# actionlint refuses to run outside a repository.
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
  echo
done
