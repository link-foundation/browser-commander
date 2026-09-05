## Summary

`.github/workflows/release.yml:558` reads the package version out of
`pyproject.toml` with a line-anchored regex:

```sh
CURRENT_VERSION=$(grep -Po '(?<=^version = ")[^"]*' "$PYPROJECT")
```

TOML is a table-structured format and `grep` cannot see tables, so this matches
`version` in **every** table, not only in `[project]`. The template already
ships `[tool.scriv]` (`pyproject.toml:140`), and scriv's documented way to make
`scriv collect --version` work is to add a `version` key to exactly that table:

```toml
[tool.scriv]
version = "literal: pyproject.toml: project.version"
```

The moment that line is added — which is what scriv's own documentation
recommends — the scrape returns two lines. `CURRENT_VERSION` becomes multi-line,
and the step writes a multi-line value into `$GITHUB_OUTPUT`, which the runner
rejects:

```
##[error]Unable to process file command 'output' successfully.
##[error]Invalid format 'literal: pyproject.toml: project.version'
```

That is a real run: `link-foundation/browser-commander` run 33920348247, log
line 340, on a repository built from this template.

Adding `| head -1` does **not** fix it. It makes the released version depend on
which table happens to come first in the file: put `[tool.scriv]` above
`[project]` and the pipeline tags a release named
`vliteral: pyproject.toml: project.version`.

## Reproducible example

```sh
mkdir /tmp/scrape && cd /tmp/scrape
cat > pyproject.toml <<'TOML'
[project]
name = "demo"
version = "1.4.2"

[tool.scriv]
format = "md"
version = "literal: pyproject.toml: project.version"
TOML

grep -Po '(?<=^version = ")[^"]*' pyproject.toml
```

Observed:

```
1.4.2
literal: pyproject.toml: project.version
```

Expected: `1.4.2`.

In the workflow the second line lands in `$GITHUB_OUTPUT` and the step fails
before the release can start. Note the failure is *not* at the point of the
mistake — the log blames the output file, not the grep.

## Workaround

Anchor the match to the `[project]` table before reading it:

```sh
CURRENT_VERSION=$(awk '/^\[project\]/{f=1;next} /^\[/{f=0} f && /^version *= *"/{gsub(/^version *= *"|"$/,"");print;exit}' "$PYPROJECT")
```

## Suggested fix in code

Parse the manifest and address the field by its table path instead of by line
shape. `tomllib` is in the standard library from Python 3.11, and the workflow
already runs `actions/setup-python` with `3.13` before this step:

```python
#!/usr/bin/env python3
"""Read one field from a manifest by its table path."""
import argparse, os, sys, tomllib
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("manifest", type=Path)
parser.add_argument("--field", default="project.version")
parser.add_argument("--output", help="write name=value to $GITHUB_OUTPUT")
args = parser.parse_args()

with args.manifest.open("rb") as handle:
    document = tomllib.load(handle)

value = document
for part in args.field.split("."):
    value = value[part]          # KeyError -> loud failure, not a wrong version

if args.output:
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as out:
        out.write(f"{args.output}={value}\n")
print(value)
```

and in `release.yml`:

```yaml
      - name: Check if version changed
        id: version_check
        run: |
          PYTHON_ROOT="${{ steps.python_layout.outputs.root }}"
          CURRENT_VERSION=$(python scripts/read_manifest.py "$PYTHON_ROOT/pyproject.toml" --field project.version)
          echo "current_version=$CURRENT_VERSION" >> "$GITHUB_OUTPUT"
```

Two properties worth keeping: the reader **fails loudly** when the field is
absent (a missing version must not become an empty tag), and it writes to
`$GITHUB_OUTPUT` itself so the value is written exactly once.

To stop the class rather than the instance, a workflow-lint rule that rejects
any `run:` body mentioning `pyproject.toml` or `Cargo.toml` together with
`grep`/`sed`/`awk`/`cut` and `version`/`name` catches every future
reintroduction. `link-foundation/browser-commander` implements this as a rule in
`scripts/check-ci-workflows.mjs`.

## Where this came from

Found while fixing every false positive, false negative, warning and error in
the CI of a repository built from these templates:
link-foundation/browser-commander#81 (PR link-foundation/browser-commander#82),
root cause RC-1. The same defect in a different language is reported against the
Rust template as well: the regex in `scripts/rust-paths.rs` is table-blind in
the same way.
