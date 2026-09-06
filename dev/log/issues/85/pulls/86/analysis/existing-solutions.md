# Existing solutions

The task asks whether a known component or library already solves this. Some
do, and the search is worth recording even where the answer was "not for us",
because two of the findings say something about the defect itself.

## The problem is well known, and the usual advice is the advice we followed

The most useful confirmation came from `semantic-release`, which has been
fighting this exact race for years: concurrent runs "fail with `[rejected]
refs/notes/semantic-release -> refs/notes/semantic-release (fetch first)`"
([semantic-release#1613](https://github.com/semantic-release/semantic-release/issues/1613)),
and `@semantic-release/git` "will fail if the local branch is behind remote"
([semantic-release#1849](https://github.com/semantic-release/semantic-release/issues/1849)).

The community's standard remedy is: *use a concurrency group with
`cancel-in-progress: false`.*

That is precisely what this repository already did, and it is precisely what was
not enough. Finding the canonical advice and finding that we had already taken
it is what turned "we must be missing a lock" into "the lock is fine, the tree
is stale" — and it is why the same gap is now filed against the best-practices
document (link-assistant/hive-mind#2220).

`stefanzweifel/git-auto-commit-action` reaches the same wall from the other
side and declines to solve it on purpose: it "does not support git rebase or
git merge, as there are many strategies on how to integrate remote upstream
changes… and git-auto-commit does not want to be responsible for doing that"
([#209](https://github.com/stefanzweifel/git-auto-commit-action/issues/209)).
A reasonable boundary for a general-purpose action, and it means adopting it
would leave us exactly where we started.

## Options evaluated

| Option | What it would give us | Verdict |
| --- | --- | --- |
| [`nick-fields/retry`](https://github.com/nick-fields/retry) wrapping `git pull --rebase && git push` | The retry loop, in one workflow line | **Rejected.** It retries on *any* failure, which is the specific bug being reported upstream against the rust template: a GH006/GH013 ruleset rejection is retried as though it were a lost race, three times, with a log that names the wrong cause. It also cannot help the two release paths that push from inside a Node/Python script rather than from a `run:` block. |
| [`stefanzweifel/git-auto-commit-action`](https://github.com/stefanzweifel/git-auto-commit-action) | Commit + push as an action | **Rejected.** Explicitly out of scope upstream (above). |
| [`ad-m/github-push-action`](https://github.com/ad-m/github-push-action) | Push with a token | **Rejected.** Solves authentication, not rejection recovery. |
| [`googleapis/release-please`](https://github.com/googleapis/release-please) | Sidesteps the race entirely: "rather than continuously releasing what's landed to your default branch, release-please maintains Release PRs" — the bump arrives by merge, so nothing ever pushes to `main` from a runner | **Rejected for this pull request, genuinely attractive otherwise.** It is a different release model, not a fix: adopting it means replacing changesets, `scriv` and `changelog.d` across three languages at once, in the same change that is supposed to get releases working again. Worth its own issue. |
| [`changesets/action`](https://github.com/changesets/action) | Same PR-based model for the JS side | **Rejected**, same reason, and it would only cover one of three languages. |
| [`peter-evans/create-pull-request`](https://github.com/peter-evans/create-pull-request) | The building block behind the JS template's `land-via-pull-request.mjs` | **Rejected**, with the reasoning recorded in the header of `scripts/push-with-rebase-retry.mjs`: `main` here accepts direct `GITHUB_TOKEN` pushes (proved by the JS release landing `ab1c5aa`), so a rule rejection would mean the repository's configuration changed and a human should see that rather than have it routed around. |
| `git push --force-with-lease` | — | **Not applicable**, and worth saying why: it makes a stale push *succeed*, discarding whatever the other writer landed. The lease protects against a concurrent change you did not see; it does not integrate one. |
| The JS template's own `push-failure-classifier.mjs` | Correct classification of the rejection | **Adopted.** See `../templates/comparison.md`. |

## What was built, and why it is small

Roughly 120 lines of JS plus a Python transliteration. That is not
not-invented-here: the release paths already run as Node and Python scripts, so
a workflow-level action cannot reach three of the four push sites, and the one
thing every off-the-shelf option omits — telling a lost race apart from a
ruleset rejection before choosing a recovery — is the part that makes the retry
correct rather than merely present.

Sources:

- [semantic-release#1613](https://github.com/semantic-release/semantic-release/issues/1613)
- [semantic-release#1849](https://github.com/semantic-release/semantic-release/issues/1849)
- [git-auto-commit-action#209](https://github.com/stefanzweifel/git-auto-commit-action/issues/209)
- [nick-fields/retry](https://github.com/nick-fields/retry)
- [googleapis/release-please](https://github.com/googleapis/release-please)
