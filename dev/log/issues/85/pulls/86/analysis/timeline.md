# Timeline: the 8 runs at `67c003c`

Every run below was triggered by the same push to `main`, commit `67c003c`
("docs: name the command the rust commit gate actually runs"), at
2026-09-05T23:27:43Z. Sources: `../ci-logs/run-*.json` (run metadata),
`../ci-logs/run-*.log` (full logs), `../annotations/run-*.tsv` (the annotations
GitHub actually surfaced).

| Run | Workflow | Conclusion | Created → Updated |
| --- | --- | --- | --- |
| 33998729880 | Security | success | 23:27:43 → 23:37:44 |
| 33998729892 | CI Workflow Policy | success | 23:27:43 → 23:28:40 |
| 33998729917 | JS CI/CD Pipeline | success | 23:27:43 → 23:30:11 |
| 33998729934 | **Python CI/CD Pipeline** | **failure** | 23:27:43 → 23:30:36 |
| 33998729936 | Repository Quality Gates | success | 23:27:43 → 23:28:45 |
| 33998729942 | Documentation | success | 23:27:43 → 23:29:26 |
| 33998729944 | Broken Link Checker | success | 23:27:43 → 23:28:37 |
| 33998729958 | **Rust CI/CD Pipeline** | **failure** | 23:27:43 → 23:31:36 |

## The sequence that matters

The three release jobs share the concurrency group
`main-writer-${{ github.repository }}-main`. The timings show it working
exactly as designed — the three never overlap:

| Time (UTC) | Event |
| --- | --- |
| 23:27:43 | All 8 runs created at `67c003c`. |
| 23:29:27 | **JS Release** job starts. Holds the `main-writer` lock. |
| 23:29:44 | JS pushes `ab1c5aa 0.17.1`. `main` is now one commit ahead of `67c003c`. |
| 23:30:01 | JS Release job ends, releasing the lock. |
| 23:30:09 | **Python Auto Release** job starts. Checkout is at `67c003c`. |
| 23:30:23 | `git push origin HEAD:main` → `! [rejected] HEAD -> main (non-fast-forward)`. Job fails. |
| 23:31:00 | **Rust Auto Release** job starts. Checkout is also at `67c003c`. |
| 23:31:26 | `git push` → `! [rejected] main -> main (non-fast-forward)`. Job fails. |

Both rejections are quoted verbatim from the logs:
`run-33998729934.log:3307` and `run-33998729958.log:8203`.

## Reading the sequence

Serialisation was never the problem. The lock did its job: one writer at a
time, in a well-defined order. What the lock cannot do is change what each
job checked out. `actions/checkout@v6` checks out `github.sha` — the commit
that *triggered* the run — not the branch tip at the moment the job starts.
So the second and third writers were guaranteed to be working one commit
behind `main`, and their pushes were guaranteed to be rejected.

The JS job succeeded not because it was correct but because it went first.
The order of the three languages is the only thing that decided which one
released.

## The longer sequence, from the registry

The same failure has been happening for a while, and it left a trace outside
this repository (`../metadata/crates-io.json`):

- crates.io carries `browser-commander` up to **0.10.11**, published
  2026-09-05T15:27:08Z.
- `rust/Cargo.toml` on `main` still says **0.9.0**.
- The remote has **no `rust-v*` and no `python-v*` tags at all**.

The Rust release commit has therefore never landed on `main`. Each run bumps
the version in the runner, publishes to crates.io, and then fails to push —
so the next run starts from 0.9.0 again, walks forward past every version
already on the registry, and publishes the next one. That walk is what
produced the 12 warnings in run 33998729958 (RC-2).
