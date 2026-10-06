# Issue #128: online sources and existing components

Each source was opened on 2026-10-06, and the quoted or paraphrased fact was
checked against it.

## Facts used in the fixes

| Topic | Source | What it established |
|---|---|---|
| sqlite3 connections in `with` (signal 6) | [Python docs, sqlite3](https://docs.python.org/3/library/sqlite3.html), "How to use the connection context manager" | "The context manager neither implicitly opens a new transaction nor closes the connection." Hence `contextlib.closing`. |
| Node server close (signal 1) | [Node.js docs, http](https://nodejs.org/api/http.html), `server.closeIdleConnections()` and `server.closeAllConnections()` | `close()` stops accepting connections but waits for open ones. The two methods drop idle and all connections. |
| Doc tests in `cargo test` (signal 2) | [cargo test](https://doc.rust-lang.org/cargo/commands/cargo-test.html) | Without target selection flags, `cargo test` builds and runs the library's documentation tests. `--doc` runs only those. |
| PyPI trusted publishing (signal 3) | [PyPI docs, troubleshooting trusted publishers](https://docs.pypi.org/trusted-publishers/troubleshooting/) | `invalid-publisher` means no publisher matches the claims (owner, repository, workflow, environment). The fix is on PyPI's side. |
| Runner label migration (signal 13) | [actions/runner-images](https://github.com/actions/runner-images) and the run annotation in `../github/annotations-37509328352.json` | `ubuntu-latest` moves to Ubuntu 26 from 2026-10-19; pinned labels do not move. |
| Workflow command injection (P1-5) | [GitHub docs, workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands), "Stopping and starting workflow commands" | `::stop-commands::<token>` stops command processing until `::<token>::`. The token must be unpredictable. |
| lychee cache (signal 16) | [lycheeverse/lychee-action README](https://github.com/lycheeverse/lychee-action), "Utilising the cache feature" | `--cache` needs `actions/cache` with `path: .lycheecache` and a `restore-keys` prefix. |
| Bot e-mail (P2-7) | [actions/checkout README](https://github.com/actions/checkout), "Push a commit using the built-in token" | The documented identity is `41898282+github-actions[bot]@users.noreply.github.com`. The commits API attributed both forms to `github-actions[bot]` (`../reproductions/bot-email-unprefixed-before.log`). |
| zizmor pinning (signal 14) | [zizmorcore/zizmor-action](https://github.com/zizmorcore/zizmor-action) | The `version` input picks the zizmor release. v0.6.2 cannot install 1.30.1; v0.6.4 can (`../reproductions/zizmor-action-unknown-version.log`). |
| TypeScript 7 virtual file system (signal 5, Windows) | [microsoft/typescript-go](https://github.com/microsoft/typescript-go) and the installed `js/node_modules/typescript/dist/api/fs.js` | `createVirtualFileSystem` answers `fileExists` with `fileName in content`, so keys must match the compiler's `/` paths exactly. Reproduced in `experiments/ts-virtual-fs-windows-keys.mjs`. |
| Polynomial regular expressions (signals 28, 29) | [CodeQL query help, js/polynomial-redos](https://codeql.github.com/codeql-query-help/javascript/js-polynomial-redos/) | Lazy `.+?` before a literal, and `-+$` with the global flag, backtrack quadratically on input that does not match. The fix is either to remove the ambiguity or to avoid the regular expression. The timings in `../reproductions/` confirm both cases. |
| Safari back-to-back sessions (signal 36) | [WebKit bug 240524](https://bugs.webkit.org/show_bug.cgi?id=240524) and [Apple, "About WebDriver for Safari"](https://developer.apple.com/documentation/webkit/about-webdriver-for-safari) | safaridriver allows one automation session at a time. The WebKit bug, fixed in 2022, describes a similar race against a target that is still terminating. That precedent supports a bounded retry with a fresh driver over a longer fixed sleep. |

## Existing components considered

| Component | Solves | Used here? |
|---|---|---|
| [lychee](https://github.com/lycheeverse/lychee-action) with `actions/cache` | Link checking with cached results | Yes. The cache now persists (`38f8c10`). |
| [zizmor](https://github.com/zizmorcore/zizmor-action) | Workflow security audit (artipacked, template injection, unpinned uses) | Yes, pinned to 1.30.1 at low confidence. |
| [actionlint](https://github.com/rhysd/actionlint) | Workflow syntax and embedded shellcheck | Yes, pinned by digest. |
| [secretlint](https://github.com/secretlint/secretlint) | Secret scanning | Yes, now pinned. |
| [jscpd](https://github.com/kucherenko/jscpd) | Duplicate code detection with a baseline | Yes. The JSON reporter feeds `js/scripts/check-duplication.mjs`, so only new clones are printed. |
| [re2](https://github.com/google/re2) and Rust's `regex` crate | Linear-time regular expressions | Not adopted. Two patterns are simpler as string splits, and a native dependency would be too much for them. |
| [Swatinem/rust-cache](https://github.com/Swatinem/rust-cache) | Rust target caching that prunes workspace artefacts | Not adopted. The measured Windows cache cost is acceptable (P1-2). It is the alternative if the save time grows. |
| link-foundation pipeline templates (js, python, rust) | Budget wrapper, status gate, preflight, `stop-commands` logging | Ported where this repository lagged (`template-comparison.md`). The template bugs found here are reported upstream (`../upstream/README.md`). |
