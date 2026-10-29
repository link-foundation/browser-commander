# Native profile migration

Imports are opt-in. The default launch creates a fresh profile. JS, Python and
Rust share the following declarations and fixture tests. The matrix describes
implemented behavior, including unsupported target writers; it does not claim
that all requirements of issue #122 have shipped.

<!-- migration-support:generated:begin -->

| Source family | Target family | cookies     | bookmarks   | history     | passwords   | preferences | extensions  | localStorage | indexedDB   | sessionStorage | autofill    | paymentCards        | searchEngines | siteSettings | openTabs    | downloads   | readingList | clientCertificates | passkeys       |
| ------------- | ------------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- | ------------ | ----------- | -------------- | ----------- | ------------------- | ------------- | ------------ | ----------- | ----------- | ----------- | ------------------ | -------------- |
| chromium      | chromium      | seed        | copy        | snapshot    | rekey       | copy        | copy        | unsupported  | unsupported | unsupported    | unsupported | consent/unsupported | unsupported   | unsupported  | unsupported | unsupported | unsupported | unsupported        | non-exportable |
| chromium      | firefox       | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported  | unsupported | unsupported    | unsupported | unsupported         | unsupported   | unsupported  | unsupported | unsupported | unsupported | unsupported        | unsupported    |
| chromium      | webkit        | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported  | unsupported | unsupported    | unsupported | unsupported         | unsupported   | unsupported  | unsupported | unsupported | unsupported | unsupported        | unsupported    |
| firefox       | chromium      | seed        | translate   | translate   | NSS/rekey   | unsupported | unsupported | unsupported  | unsupported | unsupported    | unsupported | consent/unsupported | unsupported   | unsupported  | unsupported | unsupported | unsupported | unsupported        | non-exportable |
| firefox       | firefox       | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported  | unsupported | unsupported    | unsupported | unsupported         | unsupported   | unsupported  | unsupported | unsupported | unsupported | unsupported        | unsupported    |
| firefox       | webkit        | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported  | unsupported | unsupported    | unsupported | unsupported         | unsupported   | unsupported  | unsupported | unsupported | unsupported | unsupported        | unsupported    |
| safari        | chromium      | seed        | translate   | translate   | CSV/rekey   | unsupported | unsupported | unsupported  | unsupported | unsupported    | unsupported | consent/unsupported | unsupported   | unsupported  | unsupported | unsupported | unsupported | unsupported        | non-exportable |
| safari        | firefox       | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported  | unsupported | unsupported    | unsupported | unsupported         | unsupported   | unsupported  | unsupported | unsupported | unsupported | unsupported        | unsupported    |
| safari        | webkit        | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported  | unsupported | unsupported    | unsupported | unsupported         | unsupported   | unsupported  | unsupported | unsupported | unsupported | unsupported        | unsupported    |

<!-- migration-support:generated:end -->

All 18 data-class names appear in the native include/report schema. Additional
classes currently return explicit unsupported reports, with zero migrated
counts. `consent/unsupported` additionally requires `includePaymentCards=true`
in JS/command streams, `include_payment_cards=True` in Python, the Rust option
of the same name, or CLI `--include-payment-cards`; selecting the class alone
does not grant consent or read the card store. Consent does not substitute for
an implemented reader/writer. `non-exportable` reports the private-key limits
of browser profile copying separately for iCloud Keychain, Google Password
Manager and Windows Hello. Authorized provider-to-provider transfers may be
available outside this importer. Certificate reports explain OS/NSS export and
hardware/non-exportable key limits.

`seed` returns cookies for the launcher to add to the running Chromium through
CDP. Direct migration does not create a cookie database. `snapshot` uses SQLite
online backup. `rekey` requires a target encryption key. `NSS/rekey` additionally
requires the Firefox primary password when set. `CSV/rekey` reads only an
explicit Safari/Passwords export. Whole-profile migration to any engine is
not implemented; `profile.snapshot` is a separate existing runtime snapshot
feature and does not guarantee migration of all encrypted stores.

Safari bookmarks preserve folders and reading-list URLs as bookmark folders;
reading-list status/preview metadata is not translated. Conversion returns a
`safari-reading-list-translated` warning. History preserves every visit, converts
the Cocoa epoch, and applies `domains` to URLs. Password CSV
parsing accepts UTF-8 BOMs, commas, quotes and multiline values, filters origins
before writing, and encrypts values for the target. Supply `passwordCsv` in JS,
`password_csv` in Python, or `MigrateProfileOptions::password_csv` in Rust:

```sh
browser-commander profile migrate --from safari --include bookmarks,history,passwords --password-csv ./export.csv --domain github.com --to ./profile/Default
```

Firefox history joins `moz_historyvisits` with `moz_places`, preserves individual
microsecond visit dates, and applies the same exact domain filter before writing
Chromium history. Bookmarks with no visit are not counted as history. Missing
visit tables return `source-format-unsupported` without creating a target;
malformed URLs or dates return per-visit `invalid-history-url` or
`invalid-history-timestamp` entries while valid visits continue to import.
`firefox-history-metadata-not-translated` reports that transition types,
referring visits and sync metadata were omitted.

Use Safari or the Passwords app's Export Passwords command to create the CSV.
The importer never directly extracts iCloud Keychain passwords. Missing CSV
input returns `safari-password-export-required`. Unsupported Safari preferences
and extensions return `safari-class-not-supported`. Named profiles use
`Safari/SafariTabs.db` metadata and `Safari/Profiles/<UUID>`; cookies prefer
`WebKit/WebsiteData/Default` or the matching `WebKit/WebsiteDataStore/<uuid>`.
Legacy `Cookies` paths remain a fallback. Protected Safari files give Full Disk
Access guidance naming the app running Browser Commander and a macOS Settings
link. Named-profile imports do not fall back to another profile's bookmarks.

Migration validates classes, host filters, target browser, protected profile
roots and source/target overlap before writing. Host filters match a whole
hostname or its subdomains, so `github.com` never matches `notgithub.com`.
Chromium history filtering removes unrelated visits, annotations, segment
usage and download chains, including redirects through unselected sites.
Derived cluster labels, keywords, duplicate-visit records and unknown History
tables cannot be safely associated with selected domains. Filtered imports
empty these tables and report `unsupported-history-metadata` for each nonempty
table; unfiltered imports preserve them.
Skipped undecryptable source passwords are removed from the private import
snapshot. Existing target passwords are preserved. Import snapshots are
vacuumed to remove deleted pages. Sources remain read-only.
SQLite stores use online backup, including committed WAL records. If a lock
prevents a consistent snapshot, the error recommends closing the source browser
or supplying a consistent read-only snapshot; live files are not copied as a
fallback. Unsupported Firefox preferences and extensions have explicit skipped
reasons.

## Refreshing saved passwords

Password imports into an existing Chromium `Login Data` merge new records.
They preserve unrelated domains and target-only logins within selected domains.
The identity is Chromium's five-field tuple: `origin_url`, `username_element`,
`username_value`, `password_element`, and `signon_realm`, compared exactly with
nulls equal. If that identity already exists, the **target wins**, including its
password and metadata. The report adds `target-existing` and does not count it
as migrated. Source password changes therefore never overwrite a target login.
A repeated import adds no duplicates and leaves the target file unchanged when
there are no new records. Host filters match exact hosts and their subdomains:
`live.com` includes `login.live.com` but excludes `notlive.com`.

New records receive target IDs. Their password notes are re-encrypted and their
note/insecurity associations are remapped to those IDs. Existing target notes,
insecurity records, schema, version markers, sync state and statistics remain
intact. Source sync state is never merged into an existing target. Summaries
contain counts and reason codes, without passwords, usernames or encryption
keys. These rules apply to JS, Python, Rust and their `profile migrate` CLIs,
including Firefox NSS and Safari CSV password writers.

**Close the target browser before any file-level password import**, and keep it
closed until the command finishes. Imports refuse browser lock markers, live
`--user-data-dir` processes, WAL/shared-memory files, active rollback journals,
or unavailable process inspection. Empty/zeroed persistent rollback journals
left by a clean close are accepted. A tool lock serializes password writers;
`target-busy` means another refresh is running. After an interrupted process,
remove a stale `.password-refresh.lock` only after confirming no browser or
refresh process uses the profile. The importer rechecks safety and target bytes
before atomically publishing its staged database. A failure leaves the existing
target database intact. Password safety is checked before other selected data
classes write files.

Existing stores must have matching login/note/insecurity table layouts and
version markers. Supported columns include the Chromium core, password sharing,
last-filled and actor-approval fields; nonempty OS keychain references, unknown
tables/columns, triggers, views and incompatible schemas refuse with
`unsupported-password-schema`. This conservative check avoids guessing at
browser-specific migrations. Firefox/Safari use the documented version-34
translation schema; a target upgraded to a different schema may require a fresh
dedicated profile. A populated or unrecognized `Login Data For Account` in either
profile refuses with `account-store-unsupported`; account-store credential
merging is unsupported. Recognized empty account stores are left byte-for-byte
intact. This prevents an apparently successful refresh from silently ignoring
account passwords.

Supply the key/keystore of the browser that will actually open the target.
Existing target passwords and notes must decrypt with that key; unsupported
target encryption (including app-bound `v20`) or a key mismatch refuses before
publication. Linux `--password-store=basic` targets require the matching basic
keystore; macOS targets require their actual Safe Storage service; Windows
targets require their own `Local State` key. Source keys are used only to decrypt
the private source snapshot. For unsupported combinations, import into a fresh
dedicated profile with the correct target browser/keystore. There is no implicit
replace mode for password refresh; whole-profile `profile.snapshot` is a separate
operation with separate semantics.

Refresh cookies in a running target through the browser cookie API. File-level
password refresh and cookie refresh have different lifecycle requirements.

Opera keys use a `Local State` beside its single-profile store before the
parent-directory fallback. Yandex `Ya Passman Data` returns
`yandex-passman-encryption-unsupported`: its extra encryption layer may require
a master password and cannot be treated as ordinary Chromium Login Data.
If the profile also contains supported `Login Data`, those passwords continue
to import and the unsupported store retains its separate diagnostic.
DuckDuckGo is detection-only and is rejected as a migration source.
Every native credential reader resolves its Safe Storage service from the shared
catalogue, including browser aliases. macOS Keychain failures name the requested
service and advise unlocking the login Keychain, granting access to the executing
app, and retrying the cookie read with `refresh=true`.

The broader pending requirements are recorded individually in
[the implementation plan](../dev/log/issues/122/pulls/123/PLAN.md):
Firefox/WebKit target writers, whole locked-profile migration, origin storage,
autofill/payment-card writers, search engines, permissions, tabs,
separate downloads/reading-list writers and certificate export,
comprehensive lock/keychain diagnostics, and installed-browser route parity.
Profile-local browser files cannot export platform passkeys from iCloud
Keychain, Google Password Manager or Windows Hello. Sign in once in a dedicated
persistent profile and retain its session as a workaround; this does not copy
the passkey itself.

Validation uses synthetic plist, SQLite, binarycookies and CSV fixtures in all
three native libraries. Linux Chromium runtime acceptance verifies imported
Safari bookmarks and filtered history visits survive opening the profile.
Firefox history acceptance also verifies all three matching fixture visits and
their exact microsecond timestamps survive opening and closing Chromium.
No macOS Safari/STP or Windows browser acceptance has been run in this Linux
workspace. Firefox/WebKit target acceptance cannot be run until those writers
are implemented. Password encryption is verified by fixture decryption; real
browser password-store acceptance is additionally exercised by
[`verify-chromium.mjs`](../experiments/issue-189/verify-chromium.mjs): active-target
refusal, scoped import into Chromium-created stores, repeat refresh, profile
reopen and SQLite integrity checks. This Linux basic-keystore check does not
establish macOS Keychain or Windows DPAPI runtime acceptance.
