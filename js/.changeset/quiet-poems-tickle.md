---
'browser-commander': patch
---

Make the release scripts fail when the commands they run fail.

`command-stream`'s `$` resolves rather than rejects on a non-zero exit, so every
`try/catch` around it in the release scripts was dead code. `loadCommandStream()`
now turns on `errexit`, the GitHub release tags are namespaced per language, and
the release job checks the formatting of the commit it is about to push.
