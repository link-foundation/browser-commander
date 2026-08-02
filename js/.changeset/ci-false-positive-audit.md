---
'browser-commander': patch
---

Fix CI/CD false positives, false negatives and warnings across all workflows

- Repair `if:` conditions that started with `!`, which a YAML plain scalar cannot do
- Replace `always()` with `!cancelled()` so cancelled runs stop propagating
- Gate `instant-release` and `changeset-pr` on lint and test, so a manual release can no longer publish unvalidated code
- Make the changelog fragment checks fail instead of only warning
- Pass `github.base_ref` and free-form `workflow_dispatch` inputs through environment variables instead of interpolating them into shell bodies
- Update `actions/setup-python` to v6, `codecov/codecov-action` to v7 and `peter-evans/create-pull-request` to v8
- Extend `scripts/check-ci-workflows.mjs` so each of the above becomes a permanent policy check
- Add repository-wide secrets scanning and a 1500-line file limit gate
