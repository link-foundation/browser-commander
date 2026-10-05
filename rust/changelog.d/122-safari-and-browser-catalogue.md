---
bump: minor
---

### Added

- Native Safari bookmark/history and explicit Passwords CSV import into Chromium, named Safari profiles and modern WebKit cookie-store preference.
- Catalogue-derived executable discovery and profile protection, Opera Local State resolution, and Yandex Ya Passman encryption reports.
- Migration option/path validation and domain isolation for cookies, history, downloads embedded in History, and passwords.
- Catalogue-derived Safe Storage credentials and service-specific macOS Keychain retry guidance. Locked SQLite stores require a consistent backup instead of a live-file copy fallback.
- Exact host/subdomain metadata counts and automatic cookie-source selection, without decoding values or SQL wildcard matching.
- Safari profile-catalogue errors retained alongside readable profiles and cookie sources, including domain-filtered listings.
- Login Data note/security associations and origin statistics filtered, retained notes re-encrypted with target keys, copied sync state reset, and unknown metadata omitted with warnings during domain-filtered imports.
- All 18 data-class selections and zero-count unsupported reports, separate boolean payment-card consent, and provider-specific passkey/certificate export limitations without accessing protected stores.
