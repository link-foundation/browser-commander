# `validate-docs` checks that four files exist and nothing about what is in them: a required section can be deleted from the README with the pipeline green

`release.yml`'s `validate-docs` job implements
[CI-CD-BEST-PRACTICES principle 12](https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md),
which asks for three things:

> - Check file size limits (e.g., max 2500 lines for docs)
> - Verify required sections exist in key documents
> - Check for broken links using tools like `lychee`

The job covers the first (through `check-file-line-limits`, as its own comment
notes) and the third is covered by `links.yml`. The second is not implemented
anywhere in the repository — the job body is a `REQUIRED_FILES` existence loop
and stops there:

```yaml
- name: Check required documentation files exist
  run: |
    REQUIRED_FILES=(
      "docs/BEST-PRACTICES.md"
      "docs/CONTRIBUTING.md"
      "README.md"
      "CHANGELOG.md"
    )
```

## Reproduction

```bash
git clone https://github.com/link-foundation/js-ai-driven-development-pipeline-template
cd js-ai-driven-development-pipeline-template

# Delete every section of the README but keep the file.
python3 - <<'PY'
import pathlib
p = pathlib.Path('README.md')
p.write_text(p.read_text().split('\n## ')[0])
PY

git commit -am 'gut the README'
```

`validate-docs` passes: the file exists. `check-file-line-limits` passes: it is
now shorter. `links.yml` passes: the links that could break went with the
sections. Nothing in the pipeline reads the document, so nothing notices that
the installation instructions are gone.

The same is true one section at a time, which is the realistic version: a
refactor drops "Extensibility / Escape Hatch" from one README, and the loss
surfaces as a user question months later rather than as a red check.

## Why "file exists" is the weak half of the principle

A deleted file shows up in `git diff --stat` as a deletion and is hard to merge
by accident. A deleted _section_ is an ordinary diff hunk in a large markdown
file, and is exactly what review skims past. The check that costs almost
nothing is the one aimed at the failure that actually happens.

## Suggested fix

Extend the requirement table from a list of paths to a list of
`path -> required level-2 headings`, and match headings as headings rather than
as substrings — a table-of-contents entry that mentions "Installation" is not
the Installation section.

A dependency-free implementation, `scripts/check-required-docs.sh`, is running
in `link-foundation/browser-commander`
([PR #84](https://github.com/link-foundation/browser-commander/pull/84)):

```bash
# `path|section|section|...`; a bare `path` requires only that the file exists.
REQUIREMENTS=(
  "README.md|Installation|Quick Start|API Reference|License"
  "docs/CONTRIBUTING.md"
)

has_heading() {
  local file="$1" section="$2"
  grep -Fxq "## ${section}" "$file"
}
```

Two details worth copying:

- **`--list` mode.** The script can print its own requirement table as
  `path<TAB>section` lines, so the tests build their fixtures from the same
  source the check reads, instead of restating the table and drifting from it.
- **A string accumulator, not an array.** bash 3.2 — still what a macOS runner
  ships — treats `${#empty[@]}` under `set -u` as an unbound variable, so an
  array-based failure list works on Ubuntu and breaks on macOS.

For a multi-language template the section list is worth more than the file
list: it is what keeps the per-language READMEs from documenting different
shapes of the same API.

## Workaround

None in the pipeline. Reviewing every markdown diff by hand is the only thing
standing in the way today.
