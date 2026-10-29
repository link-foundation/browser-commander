---
bump: patch
---

### Fixed

- Preserve existing target logins and metadata during saved-password refreshes.
  Merge new identities idempotently, remap imported notes, and refuse active
  targets, incompatible schemas, populated account stores or target-key
  mismatches before publication, including Firefox/Safari writers.
- Update ctutils and Tokio to patched versions required by the security audit.
