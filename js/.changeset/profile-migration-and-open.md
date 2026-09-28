---
'browser-commander': minor
---

Add opt-in profile migration and a no-automation "open in the user's browser"
mode (#102).

The real-browser launch stays clean by default - so signing in with a Google
account works (a nonexistent address shows "Couldn't find your Google Account",
not "This browser or app may not be secure"). New APIs close the gap to the
user's real browser:

- `migrateProfile({ from, to, include, domains, targetBrowser })` copies data
  from an installed browser's main profile into a dedicated target profile. It
  is strictly read-only on the source: SQLite databases (`History`, `Top Sites`,
  cookies, Firefox `places.sqlite`) are copied through the SQLite Online Backup
  API so a running browser is never disturbed, and JSON (`Bookmarks`,
  `Preferences`) is copied as is. Data classes are `cookies`, `bookmarks`,
  `history`, `passwords`, `preferences` and `extensions` (`ALL_DATA_CLASSES`).
  Chromium passwords are re-encrypted with the target profile's OS-keystore key;
  Firefox uses its NSS `key4.db` path. The report explains what was skipped and
  why: DBSC-bound Google cookies (`dbsc-bound`), Windows app-bound `v20`
  (`app-bound-v20`), migrated extensions whose `Secure Preferences` MAC cannot be
  forged (`mac-will-not-validate`), and Firefox primary passwords
  (`primary-password-set`).
- `launchRealBrowser({ migrateFrom })` runs that migration before launch, seeds
  the migrated cookies automatically, and returns a `migration` report on the
  session.
- `openInUserBrowser(url)` opens a URL in the user's own default browser with no
  automation (macOS `open`, Linux `xdg-open`, Windows `start`) for flows that
  only need to show a page, such as an OAuth or CLI web-login screen.

`migrateProfile`, `ALL_DATA_CLASSES`, `openInUserBrowser`, `buildOpenCommand`
and `validateOpenUrl` are exported.
