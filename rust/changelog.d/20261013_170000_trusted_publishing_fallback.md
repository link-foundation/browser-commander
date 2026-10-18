---
bump: patch
---

CI/CD: crates.io publishing tries trusted publishing (OIDC) first and falls back to the CARGO_REGISTRY_TOKEN / CARGO_TOKEN secret when it is unavailable. The release preflight verifies that fallback token with a publish request that omits the archive, so a release is blocked only when neither credential can publish.
