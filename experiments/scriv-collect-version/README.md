# `scriv collect --version` takes a version *name*, not a bump type

`.github/workflows/python.yml` (manual-release) ran:

```sh
scriv collect --version "$BUMP_TYPE"     # BUMP_TYPE is major|minor|patch
```

`scriv collect --help` documents the flag as:

```
--version TEXT       The version name to use for this entry.
```

so the literal word `patch` was written into `CHANGELOG.md` as the release
heading. Run `./run.sh` to reproduce against a throwaway fixture.
