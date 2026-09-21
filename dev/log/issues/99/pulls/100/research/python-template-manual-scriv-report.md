## Summary

The Python pipeline template's manual release passes a bump *type* to
`scriv collect --version` before it calculates the new package version:

```yaml
scriv collect --version "$BUMP_TYPE"
```

For a `patch` dispatch, Scriv therefore creates a changelog heading named
`patch`, consumes the fragments, and only afterwards
`scripts/version_and_commit.py` calculates the real numeric version. The
release script then cannot find that numeric version in `CHANGELOG.md` and
falls back to generic release notes.

Affected current template commit: `03f3c8475dd9e59327422b3e0b9971772820f115`.

## Reproducible example

```bash
git clone https://github.com/link-foundation/python-ai-driven-development-pipeline-template
cd python-ai-driven-development-pipeline-template
python -m venv .venv
. .venv/bin/activate
pip install 'scriv[toml]'
mkdir -p changelog.d
printf '### Fixed\n\n- Reproduction.\n' > changelog.d/repro.fixed.md
scriv collect --version patch
grep '^## ' CHANGELOG.md
```

Observed: the new heading is `## patch`, and the fragment is deleted.

Expected: the heading is the numeric version which the following
`version_and_commit.py --bump-type patch` command publishes.

This is also reproducible without a clone in Browser Commander CI history:
the downstream wrapper's regression test documents that the same call used to
write a section literally titled `patch`.

## Workaround

Compute the numeric next version first and pass that exact value to Scriv. If
the workflow has already consumed fragments into `## patch`, restore them from
Git and delete the invalid heading before retrying.

## Suggested code fix

Make versioning and changelog collection one atomic operation in
`scripts/version_and_commit.py`:

1. Run `bump_version.py`.
2. Re-read `project.version` as `new_version`.
3. If fragments exist, run `scriv collect --version new_version`.
4. Commit the version, fragments, and `CHANGELOG.md` together.

Then remove the workflow's earlier `Collect changelog fragments` step. Add a
test starting at `0.1.0`, dispatching `patch`, and asserting that the resulting
heading is `0.1.1`, never `patch`, and that release-note extraction finds the
fragment under `0.1.1`.

## Discovery context

Found while auditing every false positive, false negative, warning, and error
for link-foundation/browser-commander#99 / PR #100 and comparing all current
language template files.
