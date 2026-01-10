---
'browser-commander': patch
---

Fix package.json path in version-and-commit.mjs for monorepo structure

The git show command uses repository root paths, not the workflow's working directory. Since this is a monorepo with js/ and rust/ folders, the path must be js/package.json instead of just package.json.

This was causing "Unexpected end of JSON input" errors when the script tried to read package.json from the repository root (which doesn't exist) instead of js/package.json.
