---
bump: minor
---

### Added
- Native `snapshot_user_data_dir` and `launch_snapshot` for selected live
  Chromium profiles, including WAL backup, exclusion reports and owned-copy
  cleanup through Chromiumoxide, Playwright and Puppeteer.

### Fixed
- Live SQLite locks use the existing file-and-sidecar fallback immediately,
  avoiding a five-second wait for every locked database in a profile.
