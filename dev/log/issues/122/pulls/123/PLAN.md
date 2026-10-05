# Requirements, research and implementation plan

Scope: [#122](https://github.com/link-foundation/browser-commander/issues/122),
all five sub-issues, their comments, and the reopening comment on #114.
The checkout starts at 0.23.0 (JS), 0.5.3 (Python), 0.16.0 (Rust).
The repository's CLAUDE.md names an obsolete issue/branch; the current user's
explicit branch instruction takes precedence. No AGENTS.md was found.

## Execution checklist

- [x] Read the parent, five children and #114 including all comments.
- [x] Read PR #123 conversation, inline comments and reviews (none at start).
- [x] Review recent merged work (#115, #116) and existing native implementations.
- [x] Research upstream formats and libraries; record sources and tradeoffs.
- [x] Add failing minimum reproductions for the implemented fixes before changing code.
- [x] Apply implemented fixes to JS, Python, Rust and CLI/command-stream/launch paths.
- [ ] Complete every remaining feature in all five sub-issues.
- [x] Validate implemented source immutability, domain isolation, encryption and diagnostics with fixtures.
- [x] Generate capability matrices from shared byte-identical declarations and check them in CI.
- [x] Run local CI checks and all tests; keep large logs outside tracked code.
- [x] Add release fragments and commit atomic work.
- [ ] Push only the prepared branch.
- [ ] Review PR diff for regressions and synchronize current main.
- [ ] Replace WIP title/body with accurate implementation and validation evidence.
- [ ] Verify latest CI timestamps and head SHA, preserve/analyze failing logs.
- [ ] Check a clean working tree.
- [ ] Mark PR ready after every requirement and required check passes.

## Complete requirement inventory and candidate solutions

Each row is a requirement, including acceptance criteria. These are plans, not
claims that every capability has shipped. `Implemented` means the specific native
behavior is covered by fixtures in all three languages; platform acceptance is
tracked separately. `Partial` identifies requirements whose entire scope is not
implemented. `Pending` is unimplemented, not resolved by rejecting the option.
Unsupported platform capabilities must be explicit in the report and matrix.

| ID     | Requirement                                                                   | Candidate solution / implementation plan                                                          | State       |
| ------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------- |
| 122.1  | Read every listed issue and every comment; implement all five                 | Preserve issue snapshots and trace each row to native code and tests                              | Partial     |
| 122.2  | Single PR, no follow-up deferrals                                             | All work on issue-122-35d45f7a9d0c / PR #123                                                      | Partial     |
| 122.3  | Close parent and each child with separate keywords                            | Include Fixes #122, #117, #118, #119, #120, #121, each on its own line when complete              | Pending     |
| 122.4  | Describe already resolved/non-reproducible requirements                       | Distinguish existing Safari cookies and catalogue entries from new work                           | Partial     |
| 117.1  | Safari and STP Bookmarks.plist, binary and XML                                | Use native plist parsers; normalize folders, leaves and reading-list entries                      | Implemented |
| 117.2  | Translate bookmark hierarchy to every supported target                        | Canonical bookmark tree, Chromium JSON / Firefox places writer; WebKit explicit unsupported       | Partial     |
| 117.3  | History.db snapshot; preserve visits; domains filter                          | SQLite online backup; canonical URLs/visits with Cocoa epoch conversion                           | Implemented |
| 117.4  | Explicit Safari/Passwords CSV input                                           | RFC 4180 parser with quoted multiline UTF-8 fields; never extract iCloud Keychain                 | Implemented |
| 117.5  | Filter CSV by domain and encrypt with target keys                             | Filter before writing; use existing OSCrypt or NSS target encryption                              | Partial     |
| 117.6  | Actionable password-export instructions                                       | Name Safari/Passwords Export Passwords and the CSV input option                                   | Implemented |
| 117.7  | Safari container localStorage and IndexedDB                                   | Read SQLite localStorage and WebKit structured-clone data through compatible native formats       | Pending     |
| 117.8  | Modern named profiles and WebsiteDataStore paths                              | Enumerate store identifiers, distinguish conventional/legacy stores; prefer active supported data | Partial     |
| 117.9  | Unsupported Safari preferences/extensions have reasons                        | Family dispatch prevents Safari files entering Chromium readers                                   | Implemented |
| 117.10 | Synthetic binarycookies/plist/SQLite/CSV fixtures                             | Shared fixtures for both plist encodings, visits and tricky CSV fields                            | Implemented |
| 117.11 | Domains, immutable sources, Full Disk Access tests                            | Domain-isolation and source digests; injected EPERM/EACCES                                        | Partial     |
| 117.12 | Installed/default/custom source and native parity tests                       | Exercise discovery and identical options/report fields in each language                           | Partial     |
| 117.13 | Generated matrix and tested macOS/unsupported-format docs                     | Record actual tested hosts; never imply synthetic tests are macOS acceptance                      | Partial     |
| 118.1  | Opt-in import to Chromium, Firefox and WebKit                                 | Validate target engine; retain fresh-profile default                                              | Pending     |
| 118.2  | Same JS/Python/Rust and CLI/stream options                                    | Extend migration/launch schemas and serialized contracts together                                 | Partial     |
| 118.3  | Firefox cookies without CDP                                                   | cookies.sqlite schema or BiDi cookie injection                                                    | Pending     |
| 118.4  | Firefox places.sqlite translation                                             | Target-native bookmarks and history/visits writer                                                 | Pending     |
| 118.5  | Firefox logins.json + key4.db encryption                                      | NSS target-key creation/encryption; never place Login Data in Firefox                             | Pending     |
| 118.6  | Firefox prefs.js and accepted signed extensions                               | Same-family preservation with signing/version compatibility reports                               | Pending     |
| 118.7  | WebKit cookies context.addCookies                                             | Seed after persistent context creation; no CDP calls                                              | Pending     |
| 118.8  | WebKit localStorage/IndexedDB storage state                                   | Existing Playwright state API or origin-aware initialization                                      | Pending     |
| 118.9  | Persist supported WebKit files; report unsupported classes                    | Only write compatible WebKit formats; explicit skipped reasons                                    | Pending     |
| 118.10 | Whole locked Chromium/Firefox same-engine clone                               | Recursive read-only copy; SQLite backups; preserve stores and sessions                            | Pending     |
| 118.11 | Safari to WebKit clone only compatible formats                                | Do not pretend Safari and Playwright WebKit profiles are interchangeable                          | Pending     |
| 118.12 | Re-key encrypted stores and exclude runtime locks                             | Re-encrypt OSCrypt/NSS stores; report non-exportable app-bound data                               | Pending     |
| 118.13 | No silent loss of user data                                                   | Every omitted file/class reported; source must remain unchanged                                   | Partial     |
| 118.14 | Validate source/target before target mutation                                 | Reject invalid includes, engines, path overlap and protected target roots                         | Implemented |
| 118.15 | Preserve Chromium features/domains/reports                                    | Existing six-class regression suite plus new target-specific tests                                | Partial     |
| 118.16 | Fixture round trips all engines and real acceptance                           | Use installed runtimes; record unavailable engines explicitly                                     | Partial     |
| 118.17 | No Chromium files in Firefox/WebKit                                           | Assert native file layouts and fresh target cleanliness                                           | Partial     |
| 118.18 | Encrypted-store/locked-profile/CLI/native parity tests                        | Synthetic keys and locks; stream contract tests                                                   | Partial     |
| 119.1  | localStorage extraction/translation/clone                                     | Canonical origin/name/value entries from family stores                                            | Pending     |
| 119.2  | IndexedDB extraction/translation/clone                                        | Browser structured-clone decoding or exported Playwright state                                    | Pending     |
| 119.3  | sessionStorage extraction/translation/clone                                   | Browser session format adapters and origin-aware init script                                      | Pending     |
| 119.4  | Autofill addresses                                                            | Read family address schemas; target-native writer                                                 | Pending     |
| 119.5  | Payment cards explicit opt-in only                                            | Separate includePaymentCards flag; reject implicit card copying                                   | Pending     |
| 119.6  | searchEngines                                                                 | Chromium Web Data / Firefox search JSON adapters                                                  | Pending     |
| 119.7  | siteSettings/permissions                                                      | Preferences / permissions.sqlite adapters with domains filter                                     | Pending     |
| 119.8  | openTabs/sessions                                                             | Session format adapters; preserve same-engine stores                                              | Pending     |
| 119.9  | downloads history                                                             | Chromium History and Firefox annotation metadata; target acceptance                               | Pending     |
| 119.10 | readingList                                                                   | Safari bookmark reading-list and Chromium ReadingList adapters                                    | Partial     |
| 119.11 | Client certificates where OS allows                                           | Exportable certificate stores only; explicit OS/hardware limitations                              | Pending     |
| 119.12 | Explicit passkey skipped reasons                                              | Name iCloud Keychain, Google Password Manager and Windows Hello                                   | Pending     |
| 119.13 | Persistent-profile passkey workaround documentation                           | Sign in once with the platform passkey and retain the session                                     | Implemented |
| 119.14 | Domains on cookies/storage/passwords/history/permissions                      | Central host matching; remove existing history/password leakage                                   | Partial     |
| 119.15 | Every selected class has count or skipped reason                              | Validate unknown classes; never manufacture migrated counts                                       | Partial     |
| 119.16 | Warnings on lossy translation                                                 | Report discarded fields/unsupported value encodings                                               | Partial     |
| 119.17 | Family fixtures, consent, immutability, native parity                         | Add minimum reproductions and round-trip assertions                                               | Partial     |
| 120.1  | Read-only consistent snapshots for locked stores                              | Reuse SQLite online backups; preserve WAL commits                                                 | Partial     |
| 120.2  | Lock errors with snapshot guidance, Windows sharing/SQLite                    | Stable diagnostic reasons; bounded lock handling, no timeout inflation                            | Partial     |
| 120.3  | FDA EPERM/EACCES for every Safari store                                       | Shared error enrichment naming executing app and Privacy_AllFiles link                            | Partial     |
| 120.4  | Listings retain protected errors and readable sources                         | Per-source errors in results instead of swallowing browser-wide failures                          | Pending     |
| 120.5  | Keychain errors identify service/key and retry                                | Enrich Safe Storage errors; no protected-data fallback                                            | Implemented |
| 120.6  | Domain discovery across implemented site stores                               | Metadata-only names/counts; never echo passwords/storage/cookie values                            | Partial     |
| 120.7  | binarycookies listing decodes host metadata only                              | Dedicated metadata decoder that never materializes values                                         | Implemented |
| 120.8  | Shared source × target × class capabilities                                   | Byte-identical JSON plus generated precise README and CI check                                    | Partial     |
| 120.9  | Distinguish full clone from translated import                                 | Separate modes and capability declarations                                                        | Partial     |
| 120.10 | Native tests for options/reports/protection/locks                             | Exercise actual logic, beyond marker declarations                                                 | Partial     |
| 120.11 | Cross-platform diagnostics and all target round trips                         | OS-injected tests plus real runtimes where installed                                              | Partial     |
| 120.12 | Keep #114 open until complete goal ships                                      | #114 is already closed at start; do not claim incomplete work completes it                        | Recorded    |
| 121.1  | Launch/control/attach/import/default/protection every popular desktop browser | Drive all discovery/protection from one catalogue; protocol dispatch by family                    | Partial     |
| 121.2  | Opera/Opera GX on listed install paths, CDP                                   | Catalogue executables including per-user opera.exe and launcher.exe                               | Partial     |
| 121.3  | Yandex on listed install paths, CDP                                           | Catalogue browser.exe, yandex-browser(-stable) and app bundle                                     | Partial     |
| 121.4  | Vivaldi, Arc, Whale, 360, QQ launch/attach                                    | Populate platform executable tables from catalogue                                                | Partial     |
| 121.5  | Installed Firefox/LibreWolf/Waterfox/Zen/Floorp BiDi                          | Puppeteer BiDi in JS; Selenium/geckodriver or native BiDi in Python/Rust                          | Pending     |
| 121.6  | Safari safaridriver and Remote Automation guidance                            | WebDriver family route with explicit platform setup                                               | Partial     |
| 121.7  | Derive executable tables from browser-sources.json                            | Remove duplicated hard-coded per-language tables                                                  | Implemented |
| 121.8  | Derive default-profile protection from all roots                              | Reject roots and descendant profiles, including aliases/symlinks                                  | Implemented |
| 121.9  | Whale paths/key service                                                       | Add Naver Whale roots, executable/default identifiers and Whale Safe Storage                      | Implemented |
| 121.10 | 360 Secure/Extreme, QQ, Sogou sources                                         | Add Windows catalogue roots and fixture layouts                                                   | Implemented |
| 121.11 | DuckDuckGo and Tor at least detection/readable import                         | Separate detection-only from supported store families                                             | Partial     |
| 121.12 | Safari support and mobile exclusions                                          | Safari family; document Samsung Internet/UC mobile outside desktop scope                          | Implemented |
| 121.13 | Yandex Ya Passman Data supported or specific skipped reason                   | Detect custom meta/local_encryptor_data; explicit encryption/master-password limitation           | Implemented |
| 121.14 | Yandex Cookies fixture                                                        | Native Chromium cookie fixture using Yandex identity                                              | Pending     |
| 121.15 | Opera single profile and Roaming/Local State keys all OSes                    | Resolve Local State beside profile first, with documented fallback                                | Implemented |
| 121.16 | Preserve Opera messengers/VPN by default                                      | No new restrictive flags; test catalogue launches inherit existing neutral args                   | Partial     |
| 121.17 | Generated browser × capability × OS matrix in CI                              | Catalogue declares actual protocol/import/detection/protection support                            | Implemented |
| 121.18 | Fixtures each new source; Opera all OS; Yandex passman                        | Data-driven native discovery/fixture tests                                                        | Partial     |
| 121.19 | Identical language/CLI/command-stream behavior                                | Update all schemas and contract tests together                                                    | Partial     |

## Upstream findings and component choices

- [Playwright authentication](https://playwright.dev/docs/auth) documents state
  reuse and a separate sessionStorage initialization pattern. Use the existing
  Playwright integration for target state, rather than copying Chromium stores
  into WebKit. Raw engine IndexedDB formats need their own decoders.
- [Playwright browser support](https://playwright.dev/docs/browsers) distinguishes
  patched Firefox/WebKit runtimes from installed vendor browsers. Installed
  Firefox control needs the BiDi/WebDriver path.
- [Puppeteer FAQ](https://pptr.dev/faq) documents production Firefox BiDi support.
  Reuse this existing JS peer dependency rather than implement a second protocol.
- [Apple Passwords export](https://support.apple.com/en-ie/guide/passwords/mchl35b12625/mac)
  provides CSV export with limitations; use user-provided CSV input, not direct
  iCloud Keychain extraction.
- [WKWebsiteDataStore](https://developer.apple.com/documentation/webkit/wkwebsitedatastore)
  supports persistent stores by identifier. Named Safari stores must be kept
  distinct from legacy files.
- Existing SQLite components (better-sqlite3, Python sqlite3, Rust rusqlite)
  already expose online backup, so no new database dependency is needed.
- Selected plist components: [bplist-parser](https://github.com/joeferner/node-bplist-parser)
  and [plist.js](https://github.com/TooTallNate/plist.js) in JS, standard-library
  plistlib in Python, and the [plist crate](https://docs.rs/plist/latest/plist/)
  in Rust. Their native binary/XML parsers avoid introducing another decoder.
- [csv-parse](https://csv.js.org/parse/) handles quoted multiline/BOM input in JS;
  Python's csv module and Rust's csv crate provide the corresponding native parsers.
- Candidate LevelDB/structured-clone components: classic-level (JS), plyvel
  (Python), rusty-leveldb (Rust), Chromium/WebKit/Mozilla format code as primary
  references. LevelDB alone cannot decode V8/WebKit/SpiderMonkey values.
- [HackBrowserData](https://github.com/moonD4rk/HackBrowserData) and
  [browser_cookie3](https://github.com/borisbabic/browser_cookie3) are useful
  source/path references, but external subprocess readers would violate native
  cross-language parity and cannot establish target browser acceptance.

## Validation and reporting rules

The [validation record](VALIDATION.md) documents minimum reproductions, all local
checks, real Chromium acceptance and the remaining runtime/scope limits.

Record actual commands, failures and fixes, runtime availability and tests.
Use /tmp logs for local checks and ci-logs/ for downloaded failed workflow logs.
Bound stress probes; do not run uncontrolled memory/stack experiments.
Do not label pending work complete or close unimplemented requirements merely
because a skipped reason or feature marker exists.

## Implementation evidence and unresolved scope

All requirement IDs above were compared with the existing catalogue, native
readers, migration dispatch, launch paths and CLI/command-stream schemas. The
parent and every child remain incomplete; no closing keywords are appropriate.

- Safari now has binary/XML bookmark readers, folder/reading-list translation,
  visit-preserving History.db translation, explicit CSV parsing and target-key
  encryption in JS/Python/Rust. Modern named-profile discovery uses SafariTabs
  metadata and the corresponding Safari/WebsiteDataStore directories. Preference
  and extension imports have family-specific skipped reasons.
- Exact host/subdomain matching replaces substring matches at migration
  boundaries. Chromium snapshots prune unrelated URLs, visits, annotations,
  segments, download chains and slices. Password snapshots remove unselected or
  unreadable source ciphertext and vacuum deleted pages. Cookie readers retain
  their existing public substring-filter contract; migration filters the final
  cookie set exactly.
- Opera resolves its same-directory Local State before the parent fallback.
  Yandex Ya Passman Data gets a specific unsupported encryption-layer reason
  before credential lookup. Detection-only DuckDuckGo cannot enter Chromium
  migration dispatch.
- Executable discovery, control declarations and protected roots derive from the
  byte-identical catalogue. Added Whale, 360 Secure/Extreme, QQ, Sogou,
  DuckDuckGo/Tor entries and channel aliases have native fixture coverage.
- Migration validates includes/domains, target family, protected roots and
  physical source/target overlap before target writes. CLI, JSON dispatcher and
  pre-launch migration forward the explicit password CSV input.
- Catalogue credential regression tests reproduced the obsolete four-browser
  maps in Python/Rust: `google-chrome` failed despite a catalogue identity.
  Both native readers now use the shared identities, as JS already did. All
  three preserve Keychain causes while adding the service name and an unlock,
  access-approval and `refresh=true` retry path. Mocked denied/empty results and
  every declared service/alias exercise the actual native readers.
- New targets beneath symlink aliases of protected roots previously bypassed
  JavaScript/Rust launch checks. Failing regressions now pass using physical
  ancestor resolution shared with migration validation; Python's existing
  ancestor resolution already passed the equivalent fixture.
- Review found the older SQLite error fallback copying database/sidecar files
  sequentially. SQLite explicitly warns that file backups during active
  transactions can be corrupt. The reproductions showed Python returning a
  copied file under an exclusive lock and Rust invoking a reader after backup
  failed. The shared native snapshot paths now require successful online backup
  or give close-browser/consistent-snapshot guidance. WAL/exclusive-lock tests
  cover the new behavior. This does not implement a whole-profile clone.

### Why the parent is not complete

Firefox and WebKit target writers are absent. There is no whole-profile clone
mode. The current public include/report schema still has the original six data
classes: origin storage, autofill/card consent, search engines, site settings,
sessions, separate downloads/reading lists, certificates and passkey report
entries need new schemas, readers and accepted native target writers. Raw
LevelDB copies alone cannot translate engine structured-clone values; simple
SQLite/JSON copies cannot create NSS keys or compatible WebKit profiles.

Installed Firefox forks and Safari still require the existing explicit
WebDriver path; catalogue discovery does not establish automatic launch/BiDi
routing. Browser-wide protected-source aggregation, cross-store domain
metadata remain absent. Windows and macOS native browser acceptance
could not be established in this Linux workspace. Password fixture decryption
proves target-key encryption, not real browser password-store acceptance.

These are unresolved requirements inside PR #123, not proposed follow-up issues.
The capability matrix explicitly declares their current unsupported/pending
state. PR #123 must remain draft until the parent and all five children satisfy
their acceptance criteria. The already-closed state of #114 is recorded without
claiming this patch completes its original goal.

The existing Safari cookie-source listing already decodes only host metadata.
Tests corrupt a value's UTF-8 bytes and verify listing still succeeds without
exposing the value in JS, Python and Rust. Requirement 120.7 is already satisfied
by this existing behavior and retained regression coverage.

### Additional primary sources used during verification

- [SQLite active-transaction backup corruption](https://www.sqlite.org/howtocorrupt.html#backup_or_restore_while_a_transaction_is_active)
  explains why copying the main database and sidecars sequentially is unsafe.
- [SQLite online backup API](https://www.sqlite.org/backup.html) provides the
  consistent snapshot mechanism already available in the three SQLite libraries.
- [Chromium history database schema](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/history/core/browser/history_database.cc)
  supplies version/compatibility metadata for the translated Safari history.
- [Chromium annotation schema](https://chromium.googlesource.com/chromium/src/+/main/components/history/core/browser/visit_annotations_database.cc)
  and [history fixture](https://chromium.googlesource.com/chromium/src/+/refs/tags/142.0.7444.56/components/test/data/history/history.49.sql)
  informed annotation/download cleanup tests.
- [Safari profile-layout RFC](https://github.com/i358/dddddd/blob/main/rfcs/011-safari-data-storage.md)
  is an implementation reference for named stores, not Apple platform acceptance.
- [Apple Safari WebDriver](https://developer.apple.com/documentation/webkit/testing-with-webdriver-in-safari)
  describes Remote Automation prerequisites for future installed-Safari routing.
