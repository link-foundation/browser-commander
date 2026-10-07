# Package publishing setup

All three release workflows use GitHub Actions OIDC credentials. Registry
configuration lives outside this repository: editing YAML does not register a
trusted publisher. The preflight jobs test the registry exchange without
uploading a package, fail releases on rejected credentials, and report advisory
warnings on pull requests where the release identity may be unavailable.

## PyPI: register the first publisher

`browser-commander` is not on PyPI as of 2026-10-07. A maintainer with a PyPI
account must add a **pending publisher** at
<https://pypi.org/manage/account/publishing/>. Use these exact values:

| Field             | Value               |
| ----------------- | ------------------- |
| PyPI project name | `browser-commander` |
| Owner             | `link-foundation`   |
| Repository name   | `browser-commander` |
| Workflow name     | `python.yml`        |
| Environment name  | Leave empty         |

`release-preflight`, `auto-release` and `manual-release` all run in
`python.yml` with `id-token: write` and no GitHub environment. An environment
entered on PyPI would therefore prevent the identity from matching. If the
project already exists by the time this setup is performed, open its Publishing
settings and follow PyPI's [existing project instructions](https://docs.pypi.org/trusted-publishers/adding-a-publisher/)
with the same values.

After registration, re-run the failed Python workflow on `main`. A green
**Release Preflight** proves PyPI accepted the OIDC exchange; the release job
then uploads the distribution and creates the project. Verify the package at
<https://pypi.org/project/browser-commander/>. No PyPI API-token secret is
needed. Until registration is complete, `422, invalid-publisher` is an actual
release blocker and must remain visible.

See PyPI's [pending publisher instructions](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/).
[`explain_pypi_failure.py`](../python/scripts/explain_pypi_failure.py) also prints
the registration values for a failed run.

## crates.io: register the publisher and retire the secret

A crate owner must open `browser-commander` on crates.io and select
**Settings → Trusted Publishing → Add → GitHub**. The crate already exists;
this migration does not need an initial API-token publish.

| Field             | Value               |
| ----------------- | ------------------- |
| Repository owner  | `link-foundation`   |
| Repository name   | `browser-commander` |
| Workflow filename | `rust.yml`          |
| Environment       | Leave empty         |

The Rust preflight requests OIDC with audience `crates.io`, exchanges the JWT
at `/api/v1/trusted_publishing/tokens`, and immediately revokes the temporary
token. Each release job independently runs the pinned
[`rust-lang/crates-io-auth-action`](https://github.com/rust-lang/crates-io-auth-action)
immediately before publishing, passes its token to `CARGO_REGISTRY_TOKEN`, and
lets the action revoke it when the job finishes. A token minted during
preflight is never reused by a release job.

After this PR is merged and registration is complete:

1. Verify the Rust workflow on `main` has a green **Release Preflight** and
   successfully publishes using OIDC.
2. Remove `CARGO_TOKEN` from the GitHub secret scope that supplies it. If it
   is an organization secret shared by other repositories, first migrate
   those users or remove only this repository's access.
3. Revoke the old API token in the issuing crates.io account once its remaining
   users have migrated. Deleting a GitHub secret alone does not revoke it.

The workflow never falls back to the old secret. Registering a publisher and
revoking an account's token require authenticated registry access; they cannot
be completed by a repository commit. See the official
[crates.io migration instructions](https://crates.io/docs/trusted-publishing).

## npm and fixture manifests

The npm package already uses trusted publishing through `js.yml`. Preserve its
existing publisher and `id-token: write` permissions.

The issue-55 JavaScript template snapshot is `private: true`, and the
issue-128 `cookie-equiv` experiment declares `publish = false`. These are
repository fixtures, not release packages; the real `js/package.json` and
`rust/Cargo.toml` remain publishable.

## Regression checks

From the repository root, after installing the JavaScript toolchain:

```sh
node --test js/tests/unit/scripts/preflight-credentials.test.js js/tests/unit/scripts/trusted-publishing.test.js
node scripts/check-ci-workflows.mjs
```

The tests use local HTTP stubs to exercise successful exchanges, rejection,
missing OIDC permissions, unknown registry responses, token revocation,
advisory PR behavior, and credential redaction. They also check the release
steps use the action output with the same publish condition, preserve the
PyPI workflow identity, and keep both fixture manifests non-publishable.
