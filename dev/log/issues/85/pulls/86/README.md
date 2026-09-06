# Evidence and analysis — issue #85 / pull request #86

Everything issue #85 was investigated with, kept in the repository so the
conclusions can be re-checked without re-downloading anything. Logs move,
annotations expire, registries change; these do not.

## Start here

| Document | What it answers |
| --- | --- |
| [`analysis/root-causes.md`](analysis/root-causes.md) | Why the two workflows failed, and the two further defects found on the way. Also: everything examined and found *not* to be a defect. |
| [`analysis/timeline.md`](analysis/timeline.md) | What happened at `67c003c`, second by second. |
| [`analysis/requirements.md`](analysis/requirements.md) | Each requirement from the issue, where it is satisfied, and how to verify it. |
| [`analysis/best-practices-audit.md`](analysis/best-practices-audit.md) | All 15 hive-mind principles, checked against this pipeline. |
| [`analysis/existing-solutions.md`](analysis/existing-solutions.md) | Off-the-shelf options considered, and why one was adopted and seven were not. |
| [`templates/comparison.md`](templates/comparison.md) | The three-template file-tree diff, classified; what was ported; what was reported upstream. |

## Raw evidence

- `ci-logs/` — full logs and run metadata for all 8 runs at `67c003c`, plus the
  `main` run list.
- `annotations/` — the authoritative annotations for each run, pulled from the
  check-runs API. **Use these, not a grep of the logs.** Grepping finds
  `::error::` strings in runs whose real annotation count is zero, because the
  runner echoes the shell scripts that contain them.
- `issue/`, `pr/` — issue #85 and pull request #86 with all three kinds of
  comment.
- `metadata/` — `crates-io.json` (crate at 0.10.11 while `main` says 0.9.0) and
  `pypi-browser-commander.txt` (404 — never published).
- `best-practices/CI-CD-BEST-PRACTICES.md` — archived copy of the hive-mind
  document the issue points at.
- `templates/` — file trees for this repository and all three templates, and the
  mechanical difference lists.

## The short version

One defect explains both failing workflows. The `main-writer` concurrency group
serialises the three release jobs correctly — the timings show no overlap at all
— but `actions/checkout@v6` checks out `github.sha`, so every writer after the
first holds a tree one commit behind `main` and its push is rejected. No push
site rebased and retried.

The visible symptom was two red ticks. The actual damage was that the Rust crate
had reached 0.10.11 on crates.io against a `main` that still said 0.9.0, and the
Python package had never been published at all.

Fixed at all four push sites, with the rejection classified first — a
GH006/GH013 ruleset rejection also prints "rejected" and can never be rebased
away.

## Upstream

- [python template #73](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/73) — the same push, with no retry at all.
- [rust template #162](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/162) — retries a ruleset rejection as a lost race.
- [hive-mind #2220](https://github.com/link-assistant/hive-mind/issues/2220) — best-practice #10 stops one step short of the failure it exists to prevent.

## Reproducing it

`experiments/ci-repro/repro-release-push-race.sh` — bare repositories, no
network, no GitHub. Reproduces the rejection and the orphaned tag.
