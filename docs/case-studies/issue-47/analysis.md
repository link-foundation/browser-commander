# Case Study: Rust CI/CD Release Pipeline Failure (Issue #47)

## Timeline of Events

1. **2025-12-28**: Versions 0.1.1 through 0.4.0 released successfully (both crates.io and GitHub releases working)
2. **2026-01-18**: Version 0.4.0 published to crates.io (last successful crates.io publish)
3. **2026-01-18 to 2026-04-06**: Multiple CI runs succeed (lint, test, build pass), but auto-release creates GitHub releases (v0.5.0 through v0.8.0) WITHOUT publishing to crates.io
4. **2026-04-06**: Version 0.8.0 released on GitHub, but crates.io still shows only 0.4.0

## Root Cause Analysis

### Primary Root Cause: Tag-based vs crates.io-based release detection mismatch

The release pipeline has two conflicting sources of truth:

1. **`auto-release` check step** (workflow line 273-305): Correctly checks **crates.io** to determine if the current version is published
2. **`version-and-commit.mjs`** (line 127-134): Checks **git tags** to determine if a version was already released

This creates a failure loop:

```
Step 1: auto-release reads Cargo.toml → version 0.4.0
Step 2: auto-release checks crates.io for 0.4.0 → EXISTS (published Jan 18)
Step 3: Changelog fragments exist → should_release=true, skip_bump=false
Step 4: version-and-commit.mjs bumps 0.4.0 → 0.4.1
Step 5: version-and-commit.mjs checks tag v0.4.1 → EXISTS (from prior GitHub release)
Step 6: version-and-commit.mjs exits early WITHOUT updating Cargo.toml
Step 7: Cargo.toml still says 0.4.0
Step 8: cargo publish tries 0.4.0 → "already exists on crates.io index"
Step 9: publish-crate.mjs treats "already exists" as SUCCESS (masking the failure)
Step 10: create-github-release tries v0.4.0 → HTTP 422 "already_exists"
Step 11: create-github-release treats 422 as success (masking the failure)
```

### Contributing Factors

1. **Silent error masking**: Both `publish-crate.mjs` and `create-github-release.mjs` treat "already exists" errors as success, hiding the fact that no new version was actually released
2. **No version synchronization**: Cargo.toml version (0.4.0) became permanently out of sync with GitHub releases (v0.8.0) because the version bump commit was never pushed
3. **Tag pollution**: GitHub releases created tags (v0.4.1 through v0.8.0) that block future version bumps since `version-and-commit.mjs` considers any existing tag as "already released"
4. **Deprecated `set-output` usage**: The script uses `::set-output` (deprecated) alongside `$GITHUB_OUTPUT`, generating warnings but not causing failures

### Evidence from CI Logs

From run `24052845183` (2026-04-06):
```
Line 4648: Crate: browser-commander, Version: 0.4.0, Published on crates.io: false
Line 4660: fatal: ambiguous argument 'v0.4.1': unknown revision or path not in the working tree.
Line 4664: Tag v0.4.1 already exists
Line 5095: Package: browser-commander@0.4.0
Line 5100: error: crate browser-commander@0.4.0 already exists on crates.io index
Line 5101: Successfully published browser-commander@0.4.0 to crates.io   ← MASKED ERROR
Line 5116: gh: Validation Failed (HTTP 422)                                ← MASKED ERROR
```

Note: Line 4648 reports `Published on crates.io: false` because the crates.io API response format check (`grep -q '"version"'`) may have matched incorrectly, or there was a transient API issue. Regardless, the version-and-commit.mjs tag check is the blocking issue.

## Solutions Implemented

### Fix 1: Check crates.io instead of git tags in version-and-commit.mjs

Replace `checkTagExists()` with `checkVersionOnCratesIo()` that queries the crates.io API. This aligns the script with the same source of truth used by the auto-release check step.

### Fix 2: Skip tag check when version bump was explicitly requested

When the auto-release job determines fragments exist and a bump is needed, version-and-commit.mjs should find the next available version that hasn't been published to crates.io, rather than being blocked by git tags.

### Fix 3: Bump Cargo.toml to next unpublished version

Since tags v0.4.1 through v0.8.0 exist but crates.io only has 0.4.0, we need to advance the Cargo.toml version past all existing tags to a version that hasn't been used.

### Fix 4: Remove deprecated set-output usage

Replace `::set-output` with `$GITHUB_OUTPUT` file writes exclusively.

## Comparison with Reference Repositories

| Feature | browser-commander | lino-arguments | Numbers | Template |
|---------|-------------------|----------------|---------|----------|
| Release source of truth | Git tags (broken) | Git tags + crates.io | Reusable workflows | crates.io |
| Error masking | Yes (silent) | Better error reporting | N/A | Better |
| Tag prefixes | None (collision risk) | `js_`, `rust_` | Mixed | Standardized |
| Version modification PR check | No | Yes | No | No |
| Rust code coverage | No | No | Yes (cargo-llvm-cov) | No |

## Recommendations

1. **Immediate**: Fix version-and-commit.mjs to check crates.io, bump Cargo.toml version
2. **Short-term**: Add tag prefixes (`rust-v`) to avoid cross-language tag collisions
3. **Medium-term**: Add cargo-llvm-cov for Rust code coverage (per Numbers repo)
4. **Long-term**: Consider reusable workflows (per Numbers/linksplatform pattern)
