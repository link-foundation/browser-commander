One release prerequisite cannot be changed from this repository: PyPI rejected
the 0.5.3 OIDC exchange with `invalid-publisher`, and the `browser-commander`
PyPI JSON endpoint still returns 404.

Please register a **pending GitHub Trusted Publisher** on PyPI with these exact
claims:

- PyPI project: `browser-commander`
- GitHub owner: `link-foundation`
- Repository: `browser-commander`
- Workflow: `python.yml`
- Environment: leave empty (the job declares no environment)

Then rerun the failed Python release. PR #100 makes that retry idempotent: it
will reuse the existing 0.5.3 changelog entry and leave fragments 90/95/97 (and
newer fragments) queued for the next version. It intentionally does not hide or
bypass the publisher failure with a long-lived token.

Evidence: run 34017112193 lines 3546-3604 and
`dev/log/issues/99/pulls/100/research/pypi-browser-commander-*`.
