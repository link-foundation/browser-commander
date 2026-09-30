---
bump: minor
---

### Added
- Native typed extension relay with origin and extension-ID checks, tab
  operations, CDP sessions/events, bounded requests, cancellation cleanup and
  the bundled companion extension; session handles implement `CdpTransport`.
- Native typed parity measurement with a plain command-stream reference,
  the shared environment probe, command-line comparison and portable reports
  through Chromiumoxide, Playwright and Puppeteer.
- Native `snapshot_user_data_dir` and `launch_snapshot` for selected live
  Chromium profiles, including WAL backup, exclusion reports and owned-copy
  cleanup through Chromiumoxide, Playwright and Puppeteer.

### Fixed
- Live SQLite locks use the existing file-and-sidecar fallback immediately,
  avoiding a five-second wait for every locked database in a profile.
