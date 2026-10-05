---
'browser-commander': minor
---

Import Safari bookmarks, history and explicit Passwords CSV exports into Chromium profiles. Discover named Safari profiles and modern WebKit cookie stores. Derive desktop browser executable discovery and profile protection from the shared catalogue, fix Opera Local State lookup, and report Yandex Ya Passman encryption limitations. Enforce domain boundaries for migrated cookies, history and passwords, and validate migration paths and options before writing.

Resolve native Safe Storage credentials from the catalogue and provide service-specific macOS Keychain retry guidance. SQLite stores that cannot be backed up consistently return close-browser/retry guidance instead of copying live database files.

Match exact hosts and subdomains in cookie-source metadata and automatic source selection, without decoding cookie values or treating domain strings as SQL wildcard patterns.

Keep Safari profile-catalogue errors alongside readable profiles and cookie sources, including domain-filtered listings.

Filter associated Login Data notes, security records and origin statistics; re-encrypt retained notes with the target key. Reset copied sync state and report unknown metadata omitted during domain-filtered imports.

Recognize all 18 migration data classes with explicit unsupported reports. Add separate payment-card consent across native APIs, pre-launch migration, CLI and command streams, plus provider-specific passkey and certificate export limitations without accessing protected stores.

Translate Firefox history to Chromium with exact microsecond visit dates, domain filtering, immutable snapshots and per-visit malformed-data reports.

Normalize Firefox schema 16+ cookie expiry from milliseconds to seconds in both installed-profile reading and migration, preserving legacy schemas and session markers.

Preserve supported Yandex Login Data imports when an unsupported Ya Passman Data store is present, retaining separate encryption diagnostics.

Omit derived cluster labels, keywords, duplicate-visit records and unknown History metadata with named warnings during domain-filtered imports; preserve them during unfiltered imports.
