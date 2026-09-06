---
'browser-commander': patch
---

Recover a release push that lost the race to `main` instead of failing the run.

The `main-writer` concurrency group serialises the three release jobs correctly,
but `actions/checkout` checks out `github.sha`, so every writer after the first
holds a tree one commit behind `main` and its push is rejected as
non-fast-forward. Serialisation buys ordering, not freshness. Every push to
`main` now rebases and retries — after classifying the rejection, because a
GH006/GH013 ruleset rejection also prints "rejected" and can never be rebased
away.
