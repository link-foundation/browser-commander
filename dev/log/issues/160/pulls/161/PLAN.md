# Issue 160: requirements, research, implementation and verification plan

All work belongs to PR https://github.com/link-foundation/browser-commander/pull/161 on branch `issue-160-07f584e2bacf`. The source issue bodies and every comment are preserved in `issues.json`.

## Workflow

- [x] Verify branch and clean initial working tree; read parent issue, all twelve child issues and all comments; inspect existing PR and its three comment types.
- [x] Trace every requirement through JavaScript, Python and Rust, including shared browser scripts, CLI options, docs, readers and replay.
- [x] Research primary upstream documentation and existing components; record sources, alternatives and decisions.
- [x] Create minimal failing regression tests before implementing each defect; use bounded experiments in `experiments/issue-160/` where needed.
- [x] Implement and commit independently useful steps after relevant local checks.
- [x] Run full local suites and repository checks, and browser integration checks for lifecycle/navigation/trace changes.
- [x] Prepare release fragments according to the existing automated release workflows.
- [x] Fetch current main, verify it is already an ancestor, and review the complete local diff for regressions and scope.
- [ ] Push only the prepared branch and review the published PR diff.
- [ ] Replace WIP title/body, document reproduction and automated validation, include all thirteen separate closing references.
- [ ] Verify CI runs match the latest SHA and timestamp; preserve non-passing logs in `ci-logs/`, investigate errors with line references, fix and rerun.
- [ ] Confirm clean working tree, passing latest CI and consistent code/tests/docs, then mark PR 161 ready.

This checklist records the state before the implementation push. Final remote
validation and readiness are reported in PR 161 against the pushed commit SHA.

## Complete requirement matrix and candidate solutions

### #148: trace size and repeated mutation payloads

1. Remove or deduplicate repeated target outerHTML from attribute, live-state and child-list records; retain paths and required added-node content. Candidate: path-only targets; alternative node-ID dictionary. Prefer path-only targets compatible with existing replay.
2. Continuous tracing must continue after a bundle limit rather than silently dropping every later interval. Candidate: pre-write rolling segments plus bounded interval/snapshot truncation; alternatives gzip alone or caller-raised limit (neither solves unbounded streams).
3. Document default limits, truncation/rotation behavior and retention.
4. Redact hidden inputs by default in every language/shared page script.
5. Reproduce the comment's busy-page append amplification with a bounded fixture and verify record size/HTML omission.

### #149: protected macOS paths under Bun

6. Treat EPERM and EACCES resolving protected installed-profile paths as unresolvable plain paths, retaining profile safety checks.
7. Cover lstat and realpath failures, nonexistent paths, symlinks and Bun compatibility; apply equivalent permission handling wherever physical paths are resolved.

### #150: stale tab and leaked connections

8. Treat remembered target IDs as preferences: fall back to ranked URL matchers, visible tab, first tab or a new tab when missing. Keep explicitly requested strict selection behavior unless caller opts into fallback.
9. Disconnect engine connections on every post-connect failure, including selection, storage restore, download setup and lifecycle initialization.
10. Support ranked URL matcher lists (strings/regexes/callbacks where native API permits) across connectors and persistent reuse APIs.

### #151: persistent browser lifecycle

11. Offer explicit adoption of an already-running loopback browser when metadata is absent; verify requested profile identity before assigning ownership. Alternative blind adoption is inappropriate because close would affect an unrelated browser.
12. Keep attached controllers active even without navigations; update metadata using bounded heartbeat and stop it on detach.
13. Offer ongoing enforcement that closes subsequently opened tabs; clean up listeners/tasks on detach and preserve selected tab.

### #152: network privacy

14. Redact nested JSON, URL-encoded form and multipart fields by sensitive field name (password/token/csrf/xsrf/otp etc.) before all outputs.
15. Store textual response bodies as UTF-8, apply patterns/callback; omit binary body payloads and record original byte size. Maintain HAR/reader compatibility.
16. Redact header names matching token/csrf/xsrf patterns and established credential names.
17. Add xsrf, _xsrf and csrf query defaults and hidden input selectors.
18. Verify secrets absent from events (plain/gzip), HAR and links output, with public positive controls.

### #153: DOM privacy and bounded incremental links

19. Apply privacy patterns and callback to checkpoint HTML, mutation records and DOM links before disk writes; cover meta-token and embedded script/JSON content.
20. Feed only new checkpoint/mutation batches to links instead of repeatedly loading the entire trace.
21. Bound snapshots, intervals and retained deduplication state; emit explicit truncation markers and keep subsequent intervals usable.
22. Test the reported sentinel reproduction and bounded many-drain behavior without host-exhausting inputs.

### #154: rotation fidelity and retention

23. Rotate before a write exceeds a nonempty segment, including an individual write larger than the segment budget; avoid silently dropping payloads.
24. Keep all segments by default; expose explicit finite deletion retention and/or compressed archival alternatives.
25. Match normal trace handle fields/methods, especially links and meaningful active path, while retaining rolling root/segment metadata.
26. Serialize writes/rotation/stop to preserve continuity and test oversized writes without relying on timer timing.

### #155: interrupted navigation

27. Translate superseded net::ERR_ABORTED navigations to a recognized interrupted navigation error/outcome; preserve genuine non-navigation errors.
28. Reproduce overlapping goto calls and verify recognizer, diagnostics and recovery across engines/languages.

### #156: trigger concurrency

29. Document the 0.28 default skip behavior as breaking and explain its interaction with stop grace.
30. Offer queued start or per-trigger slots to avoid one stuck action blocking unrelated triggers. Candidate bounded latest pending start plus optional per-trigger slots; alternatives unbounded queue or unsafe forced overlap.
31. Preserve DOM-ready starts arriving during stop; clear/cancel obsolete queued work on navigation/removal/stop.
32. Add explicit restart tests and the DOM-ready/stop race, including actions exceeding grace.

### #157: overlay dismissal

33. Catch dismissal errors so the requested interaction proceeds.
34. Report dismissal outcomes/errors through a callback with clear contextual data.
35. Select the first visible match, skipping hidden first matches; use finite dismissal timeout.
36. Add mocked regressions for visibility, failures and reporting; apply equivalent helpers across all implementations.

### #158: exports and packaged documentation

37. Export renderTrace and summarizeTrace from the public package API (and confirm analogous public APIs in other languages).
38. Repair README links to documentation available to installed-package readers; candidate permanent repository links rather than duplicate packaged docs.
39. Document readyOn, concurrency and overlays in shipped README/API docs.
40. Verify npm pack contents/public imports and link destinations.

### #159: zero-page CDP reconnect

41. Forward Playwright noDefaults, including explicit false, through connector and applicable language/CLI paths.
42. Recover narrowly from Browser.setDownloadBehavior/context-management failure by connecting with noDefaults and creating a page in the existing default context only if needed; preserve profile/window ownership and cleanup connections.
43. Add mocked option/failure regression plus headed real-browser zero-target reconnect integration where environment supports it. Clearly document platform-specific verification limits.

## Parent requirements

44. Implement all twelve issues in one PR; no deferred issue.
45. PR body must contain `Fixes #160` and one separate `Fixes #148` through `Fixes #159` line, using the parent block verbatim.
46. Any already-resolved or not-reproduced requirement must be explicitly identified with evidence and retain its closing reference.

## Validation and evidence

Local command output is saved under `ci-logs/` (ignored runtime artifacts); reusable probes stay under `experiments/issue-160/`. Existing CI uses eslint/prettier/duplication, pytest/ruff/mypy, cargo fmt/clippy/tests, shared asset synchronization, documentation and feature parity checks. Read files larger than 1,500 lines in chunks. Do not merge the PR into main.
