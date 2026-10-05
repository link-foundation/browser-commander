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
- [ ] Research upstream formats and libraries; record sources and tradeoffs.
- [ ] Add failing minimum reproductions before implementation.
- [ ] Apply fixes to JS, Python, Rust and their CLI/command-stream paths.
- [ ] Validate immutable sources, domain isolation, encryption and diagnostics.
- [ ] Generate capability matrices from shared byte-identical declarations.
- [ ] Run local CI checks and all tests; keep large logs outside tracked code.
- [ ] Add release fragments, commit atomic work and push only the prepared branch.
- [ ] Review PR diff for regressions and synchronize current main.
- [ ] Replace WIP title/body with accurate implementation and validation evidence.
- [ ] Verify latest CI timestamps and head SHA, preserve/analyze failing logs.
- [ ] Check a clean working tree and mark PR ready after required checks pass.

## Complete requirement inventory and candidate solutions

Each row is a requirement, including acceptance criteria. These are plans, not
claims that a capability has shipped. Unsupported platform capabilities must be
explicitly identified in the final report and capability matrix.

| ID     | Requirement                                                                   | Candidate solution / implementation plan                                                          |
| ------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 122.1  | Read every listed issue and every comment; implement all five                 | Preserve issue snapshots and trace each row to native code and tests                              |
| 122.2  | Single PR, no follow-up deferrals                                             | All work on issue-122-35d45f7a9d0c / PR #123                                                      |
| 122.3  | Close parent and each child with separate keywords                            | Include Fixes #122, #117, #118, #119, #120, #121, each on its own line when complete              |
| 122.4  | Describe already resolved/non-reproducible requirements                       | Distinguish existing Safari cookies and catalogue entries from new work                           |
| 117.1  | Safari and STP Bookmarks.plist, binary and XML                                | Use native plist parsers; normalize folders, leaves and reading-list entries                      |
| 117.2  | Translate bookmark hierarchy to every supported target                        | Canonical bookmark tree, Chromium JSON / Firefox places writer; WebKit explicit unsupported       |
| 117.3  | History.db snapshot; preserve visits; domains filter                          | SQLite online backup; canonical URLs/visits with Cocoa epoch conversion                           |
| 117.4  | Explicit Safari/Passwords CSV input                                           | RFC 4180 parser with quoted multiline UTF-8 fields; never extract iCloud Keychain                 |
| 117.5  | Filter CSV by domain and encrypt with target keys                             | Filter before writing; use existing OSCrypt or NSS target encryption                              |
| 117.6  | Actionable password-export instructions                                       | Name Safari/Passwords Export Passwords and the CSV input option                                   |
| 117.7  | Safari container localStorage and IndexedDB                                   | Read SQLite localStorage and WebKit structured-clone data through compatible native formats       |
| 117.8  | Modern named profiles and WebsiteDataStore paths                              | Enumerate store identifiers, distinguish conventional/legacy stores; prefer active supported data |
| 117.9  | Unsupported Safari preferences/extensions have reasons                        | Family dispatch prevents Safari files entering Chromium readers                                   |
| 117.10 | Synthetic binarycookies/plist/SQLite/CSV fixtures                             | Shared fixtures for both plist encodings, visits and tricky CSV fields                            |
| 117.11 | Domains, immutable sources, Full Disk Access tests                            | Domain-isolation and source digests; injected EPERM/EACCES                                        |
| 117.12 | Installed/default/custom source and native parity tests                       | Exercise discovery and identical options/report fields in each language                           |
| 117.13 | Generated matrix and tested macOS/unsupported-format docs                     | Record actual tested hosts; never imply synthetic tests are macOS acceptance                      |
| 118.1  | Opt-in import to Chromium, Firefox and WebKit                                 | Validate target engine; retain fresh-profile default                                              |
| 118.2  | Same JS/Python/Rust and CLI/stream options                                    | Extend migration/launch schemas and serialized contracts together                                 |
| 118.3  | Firefox cookies without CDP                                                   | cookies.sqlite schema or BiDi cookie injection                                                    |
| 118.4  | Firefox places.sqlite translation                                             | Target-native bookmarks and history/visits writer                                                 |
| 118.5  | Firefox logins.json + key4.db encryption                                      | NSS target-key creation/encryption; never place Login Data in Firefox                             |
| 118.6  | Firefox prefs.js and accepted signed extensions                               | Same-family preservation with signing/version compatibility reports                               |
| 118.7  | WebKit cookies context.addCookies                                             | Seed after persistent context creation; no CDP calls                                              |
| 118.8  | WebKit localStorage/IndexedDB storage state                                   | Existing Playwright state API or origin-aware initialization                                      |
| 118.9  | Persist supported WebKit files; report unsupported classes                    | Only write compatible WebKit formats; explicit skipped reasons                                    |
| 118.10 | Whole locked Chromium/Firefox same-engine clone                               | Recursive read-only copy; SQLite backups; preserve stores and sessions                            |
| 118.11 | Safari to WebKit clone only compatible formats                                | Do not pretend Safari and Playwright WebKit profiles are interchangeable                          |
| 118.12 | Re-key encrypted stores and exclude runtime locks                             | Re-encrypt OSCrypt/NSS stores; report non-exportable app-bound data                               |
| 118.13 | No silent loss of user data                                                   | Every omitted file/class reported; source must remain unchanged                                   |
| 118.14 | Validate source/target before target mutation                                 | Reject invalid includes, engines, path overlap and protected target roots                         |
| 118.15 | Preserve Chromium features/domains/reports                                    | Existing six-class regression suite plus new target-specific tests                                |
| 118.16 | Fixture round trips all engines and real acceptance                           | Use installed runtimes; record unavailable engines explicitly                                     |
| 118.17 | No Chromium files in Firefox/WebKit                                           | Assert native file layouts and fresh target cleanliness                                           |
| 118.18 | Encrypted-store/locked-profile/CLI/native parity tests                        | Synthetic keys and locks; stream contract tests                                                   |
| 119.1  | localStorage extraction/translation/clone                                     | Canonical origin/name/value entries from family stores                                            |
| 119.2  | IndexedDB extraction/translation/clone                                        | Browser structured-clone decoding or exported Playwright state                                    |
| 119.3  | sessionStorage extraction/translation/clone                                   | Browser session format adapters and origin-aware init script                                      |
| 119.4  | Autofill addresses                                                            | Read family address schemas; target-native writer                                                 |
| 119.5  | Payment cards explicit opt-in only                                            | Separate includePaymentCards flag; reject implicit card copying                                   |
| 119.6  | searchEngines                                                                 | Chromium Web Data / Firefox search JSON adapters                                                  |
| 119.7  | siteSettings/permissions                                                      | Preferences / permissions.sqlite adapters with domains filter                                     |
| 119.8  | openTabs/sessions                                                             | Session format adapters; preserve same-engine stores                                              |
| 119.9  | downloads history                                                             | Chromium History and Firefox annotation metadata; target acceptance                               |
| 119.10 | readingList                                                                   | Safari bookmark reading-list and Chromium ReadingList adapters                                    |
| 119.11 | Client certificates where OS allows                                           | Exportable certificate stores only; explicit OS/hardware limitations                              |
| 119.12 | Explicit passkey skipped reasons                                              | Name iCloud Keychain, Google Password Manager and Windows Hello                                   |
| 119.13 | Persistent-profile passkey workaround documentation                           | Sign in once with the platform passkey and retain the session                                     |
| 119.14 | Domains on cookies/storage/passwords/history/permissions                      | Central host matching; remove existing history/password leakage                                   |
| 119.15 | Every selected class has count or skipped reason                              | Validate unknown classes; never manufacture migrated counts                                       |
| 119.16 | Warnings on lossy translation                                                 | Report discarded fields/unsupported value encodings                                               |
| 119.17 | Family fixtures, consent, immutability, native parity                         | Add minimum reproductions and round-trip assertions                                               |
| 120.1  | Read-only consistent snapshots for locked stores                              | Reuse SQLite online backups; preserve WAL commits                                                 |
| 120.2  | Lock errors with snapshot guidance, Windows sharing/SQLite                    | Stable diagnostic reasons; bounded lock handling, no timeout inflation                            |
| 120.3  | FDA EPERM/EACCES for every Safari store                                       | Shared error enrichment naming executing app and Privacy_AllFiles link                            |
| 120.4  | Listings retain protected errors and readable sources                         | Per-source errors in results instead of swallowing browser-wide failures                          |
| 120.5  | Keychain errors identify service/key and retry                                | Enrich Safe Storage errors; no protected-data fallback                                            |
| 120.6  | Domain discovery across implemented site stores                               | Metadata-only names/counts; never echo passwords/storage/cookie values                            |
| 120.7  | binarycookies listing decodes host metadata only                              | Dedicated metadata decoder that never materializes values                                         |
| 120.8  | Shared source × target × class capabilities                                   | Byte-identical JSON plus generated precise README and CI check                                    |
| 120.9  | Distinguish full clone from translated import                                 | Separate modes and capability declarations                                                        |
| 120.10 | Native tests for options/reports/protection/locks                             | Exercise actual logic, beyond marker declarations                                                 |
| 120.11 | Cross-platform diagnostics and all target round trips                         | OS-injected tests plus real runtimes where installed                                              |
| 120.12 | Keep #114 open until complete goal ships                                      | #114 is already closed at start; do not claim incomplete work completes it                        |
| 121.1  | Launch/control/attach/import/default/protection every popular desktop browser | Drive all discovery/protection from one catalogue; protocol dispatch by family                    |
| 121.2  | Opera/Opera GX on listed install paths, CDP                                   | Catalogue executables including per-user opera.exe and launcher.exe                               |
| 121.3  | Yandex on listed install paths, CDP                                           | Catalogue browser.exe, yandex-browser(-stable) and app bundle                                     |
| 121.4  | Vivaldi, Arc, Whale, 360, QQ launch/attach                                    | Populate platform executable tables from catalogue                                                |
| 121.5  | Installed Firefox/LibreWolf/Waterfox/Zen/Floorp BiDi                          | Puppeteer BiDi in JS; Selenium/geckodriver or native BiDi in Python/Rust                          |
| 121.6  | Safari safaridriver and Remote Automation guidance                            | WebDriver family route with explicit platform setup                                               |
| 121.7  | Derive executable tables from browser-sources.json                            | Remove duplicated hard-coded per-language tables                                                  |
| 121.8  | Derive default-profile protection from all roots                              | Reject roots and descendant profiles, including aliases/symlinks                                  |
| 121.9  | Whale paths/key service                                                       | Add Naver Whale roots, executable/default identifiers and Whale Safe Storage                      |
| 121.10 | 360 Secure/Extreme, QQ, Sogou sources                                         | Add Windows catalogue roots and fixture layouts                                                   |
| 121.11 | DuckDuckGo and Tor at least detection/readable import                         | Separate detection-only from supported store families                                             |
| 121.12 | Safari support and mobile exclusions                                          | Safari family; document Samsung Internet/UC mobile outside desktop scope                          |
| 121.13 | Yandex Ya Passman Data supported or specific skipped reason                   | Detect custom meta/local_encryptor_data; explicit encryption/master-password limitation           |
| 121.14 | Yandex Cookies fixture                                                        | Native Chromium cookie fixture using Yandex identity                                              |
| 121.15 | Opera single profile and Roaming/Local State keys all OSes                    | Resolve Local State beside profile first, with documented fallback                                |
| 121.16 | Preserve Opera messengers/VPN by default                                      | No new restrictive flags; test catalogue launches inherit existing neutral args                   |
| 121.17 | Generated browser × capability × OS matrix in CI                              | Catalogue declares actual protocol/import/detection/protection support                            |
| 121.18 | Fixtures each new source; Opera all OS; Yandex passman                        | Data-driven native discovery/fixture tests                                                        |
| 121.19 | Identical language/CLI/command-stream behavior                                | Update all schemas and contract tests together                                                    |

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
- Candidate plist components: bplist-parser/plist in JS, standard-library
  plistlib in Python, plist crate in Rust. Prefer established parsers over a new
  security-sensitive binary/XML decoder.
- Candidate LevelDB/structured-clone components: classic-level (JS), plyvel
  (Python), rusty-leveldb (Rust), Chromium/WebKit/Mozilla format code as primary
  references. LevelDB alone cannot decode V8/WebKit/SpiderMonkey values.
- [HackBrowserData](https://github.com/moonD4rk/HackBrowserData) and
  [browser_cookie3](https://github.com/borisbabic/browser_cookie3) are useful
  source/path references, but external subprocess readers would violate native
  cross-language parity and cannot establish target browser acceptance.

## Validation and reporting rules

Record actual commands, failures and fixes, runtime availability and tests.
Use /tmp logs for local checks and ci-logs/ for downloaded failed workflow logs.
Bound stress probes; do not run uncontrolled memory/stack experiments.
Do not label pending work complete or close unimplemented requirements merely
because a skipped reason or feature marker exists.
