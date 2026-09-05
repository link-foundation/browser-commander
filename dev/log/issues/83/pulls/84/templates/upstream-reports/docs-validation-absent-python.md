# Principle 12 (documentation validation) is not implemented: no job reads any documentation file

[CI-CD-BEST-PRACTICES principle 12](https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md) asks for three checks on documentation:

> - Check file size limits (e.g., max 2500 lines for docs)
> - Verify required sections exist in key documents
> - Check for broken links using tools like `lychee`

Only the third is implemented here (`links.yml`). The size limit stops at
source: `scripts/check_file_size.py` declares

```
FILE_EXTENSIONS = [".py"]
```

so a documentation file has no size limit at all. There is no `validate-docs`
job in `release.yml` — the job list goes `detect-changes, lint, test, build, changelog, docker-build, auto-release, manual-release, docker-publish-*, pipeline-status` — and
nothing anywhere reads a markdown file for anything other than its links. The
JS template at least has the file-presence half
(`link-foundation/js-ai-driven-development-pipeline-template`, its `validate-docs`
job); this repository has none of it.

Consequence: `README.md` and `CONTRIBUTING.md` can be deleted, emptied, or
stripped of every section, and the pipeline stays green.

## Reproduction

```bash
git clone https://github.com/link-foundation/python-ai-driven-development-pipeline-template
cd python-ai-driven-development-pipeline-template

rm CONTRIBUTING.md
python3 - <<'PY_INNER'
import pathlib
p = pathlib.Path('README.md')
p.write_text(p.read_text().split('\n## ')[0])
PY_INNER

git commit -am 'delete CONTRIBUTING.md and gut the README'
```

Every check passes. `links.yml` in particular gets _greener_: the links that
could have broken were in the sections that were removed.

## Suggested fix

Add a `validate-docs` job that checks two things a diff review reliably misses:
the documents that are supposed to exist, and the level-2 sections inside them.

A dependency-free implementation, `scripts/check-required-docs.sh`, is running
in `link-foundation/browser-commander`
([PR #84](https://github.com/link-foundation/browser-commander/pull/84)):

```bash
# `path|section|section|...`; a bare `path` requires only that the file exists.
REQUIREMENTS=(
  "README.md|Installation|Quick Start|API Reference|License"
  "CONTRIBUTING.md"
)

# Prose that mentions the words does not count: a table-of-contents entry is
# not the section it links to.
has_heading() {
  local file="$1" section="$2"
  grep -Fxq "## ${section}" "$file"
}
```

wired in as:

```yaml
validate-docs:
  name: Validate Documentation
  runs-on: ubuntu-latest
  timeout-minutes: 5
  needs: [detect-changes]
  if: needs.detect-changes.outputs.docs-changed == 'true'
  steps:
    - uses: actions/checkout@v6
    - run: bash scripts/check-required-docs.sh
```

Three details worth copying:

- **`--list` mode.** The script prints its own requirement table as
  `path<TAB>section` lines, so its tests build fixtures from the same source
  the check reads instead of restating the table and drifting from it.
- **A string accumulator, not an array.** bash 3.2 — still what a macOS runner
  ships — treats `${#empty[@]}` under `set -u` as an unbound variable, so an
  array-based failure list works on Ubuntu and breaks on macOS.
- **Add the job to `pipeline-status`'s `needs:`**, or a cancelled
  documentation check will not be reported on the default branch.

The size-limit half of the principle is a one-line change in the same place:
add `.md` to `FILE_EXTENSIONS` in `scripts/check_file_size.py`, or check documentation against its
own (larger) limit if 1500 lines is too tight for a reference document.

## Workaround

None in the pipeline: reviewing every markdown diff by hand is the only thing
standing in the way today.
