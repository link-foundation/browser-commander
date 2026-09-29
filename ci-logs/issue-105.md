# Address all 4 open issues in link-foundation/browser-commander
<!-- hive-mind-solve-repository-mode -->

## Objective

Address every open issue listed below in [link-foundation/browser-commander](https://github.com/link-foundation/browser-commander) with a **single pull request**.

This issue was generated automatically by `/solve https://github.com/link-foundation/browser-commander` (repository mode, see https://github.com/link-assistant/hive-mind/issues/2212). Every issue below is attached to this issue as a GitHub native sub-issue.

## Scope

- Open issues found in the repository: 4
- Issues attached as sub-issues of this issue: 4
- GitHub sub-issue limit per parent issue: 100

## Issues to address

- [ ] #101 launchRealBrowser uses --remote-debugging-port=0, so navigator.webdriver is true and Google refuses sign-in — opened 2026-09-28
- [ ] #102 Real-browser sessions: start clean by default, offer opt-in migration from the main browser instance, and a no-automation 'open in the user's browser' mode — opened 2026-09-28
- [ ] #103 Default launch is still far from a hand-started Chrome: ~35 engine switches, disabled Google services, a mutated host env, and a shared profile — opened 2026-09-28
- [ ] #104 Exactly the same features in every language: full Playwright/Puppeteer/WebDriver coverage in Rust and Python, and every engine reachable through a CLI via command-stream — opened 2026-09-28

## Requirements

1. Read every issue listed above (including its comments) and fully implement what it asks for.
2. Do all of the work in this single pull request. Do not defer any listed issue to a follow-up pull request.
3. The pull request description **must** close this issue and **every** issue listed above, so that merging the pull request closes all of them at once.
4. GitHub requires the full closing syntax for each issue: one keyword per issue. `Fixes #1, #2` only closes `#1`. Use the block below verbatim (plus `Fixes #<this issue>` for this issue).
5. If an issue turns out to be already resolved or not reproducible, say so explicitly in the pull request description — but still keep its closing reference so it is closed on merge.

## Required closing references in the pull request description

```
Fixes #101
Fixes #102
Fixes #103
Fixes #104
```

