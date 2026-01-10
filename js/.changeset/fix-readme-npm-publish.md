---
'browser-commander': patch
---

Include README.md in npm package

The npm package was missing the README documentation because the package is published from the js/ subdirectory, but README.md is in the repository root. This fix adds a step in the CI/CD workflow to copy README.md from the repository root to the js/ directory before publishing to npm.
