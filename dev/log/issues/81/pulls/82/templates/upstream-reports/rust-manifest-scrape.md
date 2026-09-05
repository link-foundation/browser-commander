## Summary

`scripts/rust-paths.rs:253` reads any field out of `Cargo.toml` with a
line-anchored regex:

```rust
fn find_manifest_value(content: &str, key: &str) -> Option<String> {
    let re = Regex::new(&format!(r#"(?m)^{}\s*=\s*"([^"]+)""#, regex::escape(key))).unwrap();
    re.captures(content)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_string()))
}
```

`read_package_info` (line 166) uses it for both `name` and `version`, and
`scripts/get-version.rs:65` publishes the result as the `version` step output
that drives tagging and publishing.

TOML is table-structured and this regex is table-blind: it returns the **first**
line-anchored `key = "…"` in the file, wherever it happens to live. `version`
and `name` are not unique keys in a `Cargo.toml` — they also appear under
`[dependencies.*]`, `[workspace.package]`, `[lib]` and `[[bin]]`.

The failure is silent and it produces a *wrong version*, not an error: for a
crate that inherits its version from the workspace, `version.workspace = true`
does not match the regex, so the search continues into the dependency tables and
returns a **dependency's** version as the crate's version.

## Reproducible example

`Cargo.toml` of a workspace member that uses the dependency-table form:

```toml
[package]
name = "app"
edition = "2021"
version.workspace = true

[dependencies.serde]
version = "1.0"
features = ["derive"]
```

Run the template's own function against it:

```rust
use regex::Regex;

fn find_manifest_value(content: &str, key: &str) -> Option<String> {
    let re = Regex::new(&format!(r#"(?m)^{}\s*=\s*"([^"]+)""#, regex::escape(key))).unwrap();
    re.captures(content).and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
}

fn main() {
    let manifest = std::fs::read_to_string("Cargo.toml").unwrap();
    println!("version -> {:?}", find_manifest_value(&manifest, "version"));
    println!("name    -> {:?}", find_manifest_value(&manifest, "name"));
}
```

Observed (regex 1.x, verified locally):

```
version -> Some("1.0")
name    -> Some("app")
```

Expected: either the inherited workspace version, or a hard error saying the
version is inherited. What actually happens is that the pipeline believes the
crate's version is `1.0`, checks whether tag `v1.0` exists, and — the first time
it does not — tags and attempts to publish a release named after serde's version
requirement.

The same shape bites without inheritance: any table containing a line-anchored
`version = "…"` that precedes `[package]` wins, and `[workspace.package]` is the
canonical case.

## Workaround

Keep `version = "x.y.z"` physically inside `[package]` and above every other
table that has a `version` key, and do not use the `[dependencies.<name>]`
sub-table form. That is a constraint on hand-written manifest layout that
nothing checks, which is why it is a workaround and not a fix.

## Suggested fix in code

Parse the manifest and address the field by its table path. `toml` is already an
ecosystem-standard dependency and `rust-script` resolves it from the script
header, so the change is local to `scripts/rust-paths.rs`:

```rust
fn find_manifest_value(content: &str, key: &str) -> Option<String> {
    let document: toml::Value = toml::from_str(content).ok()?;
    document
        .get("package")?
        .get(key)?
        .as_str()
        .map(str::to_string)
}
```

If adding a dependency to that script is unwanted, the minimum correct version
of the current approach tracks the table header instead of ignoring it:

```rust
fn find_manifest_value(content: &str, key: &str) -> Option<String> {
    let assignment = Regex::new(&format!(r#"^{}\s*=\s*"([^"]+)""#, regex::escape(key))).unwrap();
    let mut in_package = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_package = trimmed == "[package]";
            continue;
        }
        if in_package {
            if let Some(caps) = assignment.captures(trimmed) {
                return caps.get(1).map(|m| m.as_str().to_string());
            }
        }
    }
    None
}
```

Verified behaviour of that second version on the three manifests above:

```
inherited version       → None      (read_package_info raises "Could not find version")
inherited name          → Some("app")
workspace-first version → Some("2.3.4")   (the current code returns "0.1.0")
deps-after version      → Some("2.3.4")
```

Either way the important behaviour is the one the current code lacks:
`read_package_info` should **fail loudly** when `[package].version` is absent or
inherited (`version.workspace = true`), because a release pipeline that guesses
a version is worse than one that stops.

Suggested regression tests, next to the existing ones in `scripts/rust-paths.rs`:

1. a member manifest with `version.workspace = true` and a `[dependencies.serde]`
   table → error, not `1.0`;
2. a manifest whose `[package]` follows `[workspace.package]` → the package
   version, not the workspace one;
3. a manifest whose `[package]` is followed by `[dependencies.serde]` → the
   package version, both before and after the change (a guard against fixing
   this by reordering the search rather than by tracking the table).

## Where this came from

Found while fixing every false positive, false negative, warning and error in
the CI of a repository built from these templates:
link-foundation/browser-commander#81 (PR link-foundation/browser-commander#82),
root cause RC-1. The Python template has the identical defect in a different
language — `grep -Po '(?<=^version = ")[^"]*'` in `release.yml` — reported
separately there; that one has already caused a red release run in the wild.
