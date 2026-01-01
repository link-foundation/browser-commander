# Changelog Fragments

This directory contains changelog fragments for the Rust implementation.

## How to add a changelog entry

1. Create a new `.md` file in this directory with a descriptive name
2. Use the following format:

```markdown
---
bump: patch
---

### Added
- Your changes here
```

## Bump types

- `patch`: Bug fixes and minor changes (0.0.X)
- `minor`: New features (0.X.0)
- `major`: Breaking changes (X.0.0)

## Section headers

Use [Keep a Changelog](https://keepachangelog.com/) format:

- `### Added` - for new features
- `### Changed` - for changes in existing functionality
- `### Deprecated` - for soon-to-be removed features
- `### Removed` - for now removed features
- `### Fixed` - for any bug fixes
- `### Security` - in case of vulnerabilities

## Example

File: `add-new-selector.md`

```markdown
---
bump: minor
---

### Added
- New CSS selector support for element visibility checking
```
