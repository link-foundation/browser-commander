---
'browser-commander': patch
---

Restore the release pipeline. `const { $ } = await use('command-stream')` returned `undefined` on the Node 24 the release jobs pin, because Node 23 added a synthetic `'module.exports'` named export for CommonJS namespaces that use-m's unwrapping does not recognise, so every JS and Rust release died on its first shell call with `TypeError: $ is not a function`. Dependencies now load through `scripts/use-module.mjs`, which detects that namespace shape and unwraps it. Manifest fields are read by TOML table through `scripts/read-manifest.mjs` instead of a line-anchored `grep`, which matched duplicate keys in other tables and wrote two lines into `$GITHUB_OUTPUT`. The duplication gate had `format` set to a reporter name, so jscpd scanned zero files and passed unconditionally; it now scans the tree against a recorded baseline.
