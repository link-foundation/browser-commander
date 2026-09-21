# Authoritative online research

Sources were checked on 2026-09-21. Primary/official sources were preferred.

- [Node deprecations: DEP0137](https://nodejs.org/api/deprecations.html): file
  handles must be closed explicitly; garbage-collection closure is now
  end-of-life behavior and can throw on current Node.
- [Node end-of-life table](https://nodejs.org/en/about/eol) and
  [release table](https://nodejs.org/en/about/previous-releases): Node 20 ended
  support on 2026-03-24; Node 22 and 24 are supported LTS lines.
- [better-sqlite3 releases](https://github.com/WiseLibs/better-sqlite3/releases):
  version 13 moved to N-API and removed deprecated `prebuild-install`.
- [better-sqlite3 package metadata](https://github.com/WiseLibs/better-sqlite3/blob/master/package.json):
  current engines require Node 22 or newer.
- [npm install documentation](https://docs.npmjs.com/cli/install/): npm 12
  documents project `allowScripts`, explicit denials, version-pinned approvals,
  and strict handling of unreviewed install scripts.
- [Scriv collect documentation](https://scriv.readthedocs.io/en/latest/commands.html):
  collect aggregates and deletes current fragments under a versioned entry;
  this supports preserving later fragments when retrying an already-collected
  release.
- [PyPI Trusted Publisher troubleshooting](https://docs.pypi.org/trusted-publishers/troubleshooting/):
  `invalid-publisher` means valid OIDC claims match no configured publisher;
  owner, repository, workflow filename, and environment must agree.
- [PyPI Trusted Publisher internals](https://docs.pypi.org/trusted-publishers/internals/):
  publisher configuration is an exact OIDC-claim match and yields a short-lived
  package token.
- [CodeQL compiled-language configuration](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/manage-your-configuration/codeql-for-compiled-languages):
  Rust supports no-build analysis.
- [CodeQL workflow configuration](https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options):
  `config-file` and `paths-ignore` scope no-build analysis; Rust support is
  documented for compiled-language no-build mode.
- [download-artifact v8.0.1](https://github.com/actions/download-artifact/releases/tag/v8.0.1):
  current action release used to replace v7. Release metadata is also captured
  through GitHub CLI in the upstream report.

Repository-specific API responses and upstream issue/release bodies are
archived under `research/` so the investigation remains reviewable even if an
external page later changes.
