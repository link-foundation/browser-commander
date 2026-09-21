# Complete requirement inventory

## Explicit issue requirements

| ID | Requirement | Implementation / evidence |
| --- | --- | --- |
| R1 | Audit all CI false positives, false negatives, warnings, and errors. | Every issue-listed log and annotation is archived; `signal-classification.md` records each disposition. |
| R2 | Fix all confirmed defects in one PR. | PR 100 fixes JS, Python, Rust, docs, security, dependency, and policy defects together. |
| R3 | Compare the full file tree against all three language templates. | `templates/*-repository-files.txt`, `*-template-files.txt`, and `diffs/*-file-by-file.txt` are exhaustive sorted comparisons. |
| R4 | Reuse applicable current template practices. | Template heads are pinned in `template-comparison.md`; the current download-artifact v8 practice and regression policy were adopted. |
| R5 | Report the same defects in templates. | Python template issues 85 and 86 contain reproductions, workarounds, and code-level suggestions. No matching defect was found in the current JS or Rust template. |
| R6 | Follow the hive-mind CI/CD guide. | The exact guide at commit `ba12d5a3` is archived; changes retain gates, bounded jobs, explicit degradation, reproducible installs, and release fragments. |
| R7 | Continue until every requirement is addressed. | The plan, analysis, tests, release triggers, PR metadata, and current-SHA CI verification form the completion gate. |

## Execution requirements added by the solver request

| ID | Requirement | Implementation / evidence |
| --- | --- | --- |
| R8 | Download all issue/PR logs and data under this directory. | `github/`, `ci-logs/`, `research/`, `templates/`, and `reproductions/`; indexed by the parent README. |
| R9 | Reconstruct the sequence and find actual root causes. | `timeline.md` and `root-causes-and-solutions.md`, backed by before reproductions and allocation stacks. |
| R10 | Research online facts and reusable components/libraries. | `web-sources.md` and archived better-sqlite3, Node, PyPI, Scriv, CodeQL, npm, and action evidence. |
| R11 | Start bug fixes with reproducing tests. | Paused-writer, existing-version release retry, descriptor allocation tracing, and workflow-policy regressions precede or accompany fixes. |
| R12 | Add opt-in diagnostics if ordinary traces are insufficient. | `experiments/trace-open-filehandles.mjs` instruments `fs/promises.open`; it is inactive unless explicitly loaded with `node --import`. |
| R13 | Apply a defect everywhere it occurs. | Trace bundles are closed at API and fixture boundaries; tests that intentionally interrupt a trace explicitly stop it; dependency and action policies prevent reintroduction. |
| R14 | Preserve appropriate release triggers. | JavaScript Changesets, Python Scriv, and Rust changelog fragments describe the applicable fixes. |
| R15 | Report related-project defects when confirmed. | Template issues 85/86 were filed. PyPI's failure is a repository publisher configuration problem, not a Warehouse software defect, so the maintainer action is reported on PR 100 instead. |
| R16 | Finish the prepared PR and verify fresh CI. | Finalization requires current `main`, clean commits, updated title/body, ready status, and checks whose SHA equals the pushed head. |

## Acceptance criteria

The solution is complete when focused regressions and all local language checks
pass without the investigated warnings, PR 100 is current with `main`, the
worktree is clean, and the pushed head's required checks pass. The one external
operational prerequisite—registering the PyPI publisher—must remain visible and
must not be converted into a silent success.
