---
bump: patch
---

### Fixed

- The crates.io publish script passes the token through `CARGO_REGISTRY_TOKEN` instead of the deprecated `cargo publish --token` flag, which also keeps it out of the process argument list.
