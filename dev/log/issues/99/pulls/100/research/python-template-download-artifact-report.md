# `actions/download-artifact@v7` emits Node `DEP0005` during release

The generated Python release workflow still uses
`actions/download-artifact@v7`. A real generated-repository run completed its
artifact download but emitted this runner warning:

```text
(node:2140) [DEP0005] DeprecationWarning: Buffer() is deprecated due to
security and usability issues. Please use the Buffer.alloc(),
Buffer.allocUnsafe(), or Buffer.from() methods instead.
```

Reproduction:

1. Generate or update a repository from the current template.
2. Leave `.github/workflows/python.yml` on `actions/download-artifact@v7`.
3. Trigger the release path so the `Download artifacts` step downloads the
   built `python-dist` artifact on a GitHub-hosted runner.
4. Observe `DEP0005` from the action process. The artifact still downloads,
   which makes this a warning-only/false-negative CI signal.

Observed in `link-foundation/browser-commander` run `34017112193` on
2026-09-06, at the `Download artifacts` step. The workflow source still uses
the same v7 major tag.

Workaround: change the action to `actions/download-artifact@v8` in each
generated repository.

Suggested template fix: update the Python workflow template to v8 and add or
adjust the workflow snapshot/policy test so generated workflows cannot regress
to v7. `actions/download-artifact` v8.0.1 was released on 2026-03-11.

This was found while investigating
link-foundation/browser-commander#99; the consumer fix is in PR #100.
