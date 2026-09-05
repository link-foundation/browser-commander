# Existing components and libraries

What already exists for each root cause, whether adopting it is worth the churn
here, and what this pull request does instead. The bias is deliberately
conservative: this repository already has a working release pipeline shape
shared with three upstream templates, and replacing it wholesale would diverge
from those templates — which the issue explicitly asks us to converge on.

---

## For RC-B — a shell wrapper whose `$` actually fails

`command-stream` resolves on a non-zero exit by default. The two mainstream
alternatives take the opposite default:

| Library | Default on non-zero exit | Opt out |
| --- | --- | --- |
| [`zx`](https://google.github.io/zx/process-promise) | **throws** `ProcessOutput` | `.nothrow()`, `$({nothrow: true})`, `$.nothrow = true` |
| [`execa`](https://www.npmjs.com/package/execa) | **rejects** | `reject: false` |
| `command-stream` | resolves | `shell.errexit(true)` |

zx's design is the one the thirteen scripts in this repository were
*written* for — `try { await $\`…\` } catch { process.exit(1) }` is
idiomatic zx and dead code under `command-stream`'s defaults.

**Decision: do not migrate.** `command-stream` is a link-foundation library and
is used identically across all three pipeline templates; swapping it here would
fork this repository away from them. It also already supports the behaviour we
need — `shell.errexit(true)` — which is exactly zx's default. The fix is to
turn it on once in `scripts/use-module.mjs`, the single choke point every
consumer loads `$` through, rather than to change libraries.

The lesson worth importing from zx is not the library but the default: **a
shell wrapper should fail loudly and require an explicit opt-out for the cases
that tolerate failure.** That inverts the thirteen call sites from "silently
correct" to "explicitly annotated".

---

## For RC-C, RC-D, RC-G — release automation

| Tool | Fits | Does not fit |
| --- | --- | --- |
| [`release-please`](https://github.com/googleapis/release-please) | Genuinely multi-language in one repository — Cargo.toml, Node, Python all supported via a `.release-please-manifest.json` + `release-please-config.json` pair. Its release-PR model also solves **RC-E for free**, because the version bump arrives as a pull request that CI tests before merge, instead of as an untested direct push | Derives versions from Conventional Commits, whereas this repository uses explicit changeset/fragment files (`js/.changeset/`, `rust/changelog.d/`, `python/changelog.d/`). Adopting it means discarding all three fragment systems and diverging from all three upstream templates |
| [`cargo-release`](https://github.com/crate-ci/cargo-release) | Handles the Rust half properly: bump, changelog, commit, tag, publish, and it will not publish if the working tree is dirty or the commit failed — precisely RC-C | Rust-only; would leave JS and Python on the hand-rolled path, and adds a second release philosophy to the repository |
| [`cargo-unleash`](https://github.com/paritytech/cargo-unleash) | Workspace-scale Rust releases | Solves a problem this single-crate repository does not have |
| [`@changesets/cli`](https://github.com/changesets/changesets) | Already in use for JS, and already correct once configured — see below | — |

**Decision: fix in place, do not adopt.** RC-C is not a missing feature; it is
two bugs (an inverted exit-code test and a `collectChangelog()` that forgets to
delete what it consumed) plus a missing gate on the publish step. `release-please`
would solve it, and would solve RC-E too, but it is a rewrite of the release
model for all three languages and a fork away from the templates the issue asks
us to align with. Recorded here as the right migration if the hand-rolled
scripts keep failing — the RC-E argument for it is strong.

For RC-G the fix is a configuration key that `@changesets/cli` already has:
`"format": "prettier"` in `.changeset/config.json`, part of
`@changesets/config@4.0.0/schema.json`, which the file already references. See
[`changesets-format-detect-evidence.md`](changesets-format-detect-evidence.md)
for why the default `"auto"` picks Deno here.

---

## For RC-E — testing the release commit

The root cause is documented GitHub behaviour, not a bug: a push made with the
default `GITHUB_TOKEN` does not trigger further workflow runs, to prevent
recursion. Three known workarounds:

1. **A Personal Access Token.** Works, and is what GitHub's own docs suggest.
   Rejected: a long-lived repo-scoped PAT is a standing credential with no
   granular scoping, which conflicts with the least-privilege posture the rest
   of these workflows already keep (`permissions:` is pinned per job).
2. **A GitHub App installation token** via
   [`actions/create-github-app-token`](https://github.com/actions/create-github-app-token).
   Pushes made with it *do* trigger `push` and `pull_request` workflows, and
   permissions are scoped to the installed repositories. This is the correct
   long-term fix, but it needs a maintainer to create the App and store
   `APP_ID` / `PRIVATE_KEY` as secrets — the same class of blocked action as
   RC-A.
3. **Release-by-pull-request** (`release-please`, or
   [`peter-evans/create-pull-request`](https://github.com/peter-evans/create-pull-request)).
   Sidesteps the problem entirely: the bump is reviewed and tested as a PR.

**Decision for this pull request: neither, yet.** All three change the trust
model and two of them are blocked on a maintainer. The immediate, unblocked fix
is to validate the release commit's *content* inside the job that creates it —
run `format:check` over the touched files after the bump and before the commit
— so the specific failure already sitting on main (`js/CHANGELOG.md` failing
`prettier --check`) cannot recur. Options 2 and 3 are recorded as the proper
follow-up, with the App-token route preferred because it keeps the current
release shape.

---

## For RC-A — PyPI trusted publishing

`pypa/gh-action-pypi-publish` is already the right action and is already pinned
by SHA. The failure is not in the code.

[PyPI's own troubleshooting guide](https://docs.pypi.org/trusted-publishers/troubleshooting/)
documents `invalid-publisher` as "the OIDC token itself is well-formed (and has
a valid signature), but doesn't match any known (pending) OIDC publisher", and
requires `repository_owner`, the repository name, the workflow filename and the
environment to match on both sides. For a project that does not yet exist on
PyPI — which is this case, the JSON API returns 404 — the **pending publisher**
flow is the supported path, and the project name in the pending-publisher
registration must match the package metadata exactly.

No library removes this step; it is a one-time registration in the PyPI web UI.
What code *can* do is fail fast with the four values spelled out, so the next
person reading the log knows it is a registration gap rather than a workflow
bug. That is what F-5 adds.

---

## For F-7 — testing the release scripts

The gap is not tooling. `node --test` is built in, the repository already runs
ESLint over `scripts/`, and the rust upstream template already carries the job
this repository is missing (`script-tests`, running `bash scripts/test-scripts.sh`).
Adopting the template's job is both the smallest change and the one the issue
explicitly asks for.

The two reproductions written for this investigation are the seed cases: each
fails against the current code and passes against the fix.

| Reproduction | Root cause |
| --- | --- |
| `experiments/ci-repro/repro-command-stream-exit-code.mjs` | RC-B |
| `experiments/ci-repro/repro-changeset-deno-formatter.mjs` | RC-G |

---

## Sources

- [zx — Process Promise](https://google.github.io/zx/process-promise)
- [execa](https://www.npmjs.com/package/execa)
- [release-please](https://github.com/googleapis/release-please) and its [manifest releaser docs](https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md)
- [cargo-unleash](https://github.com/paritytech/cargo-unleash)
- [changesets/format](https://github.com/changesets/format)
- [Changesets config-file options](https://github.com/changesets/changesets/blob/main/docs/config-file-options.md)
- [Announcing Changesets v3](https://changesets.dev/blog/announcing-changesets-v3)
- [GitHub Docs — GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)
- [GitHub Docs — Triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [community discussion #25702 — push from Action does not trigger subsequent action](https://github.com/orgs/community/discussions/25702)
- [PyPI trusted publishers — troubleshooting](https://docs.pypi.org/trusted-publishers/troubleshooting/)
