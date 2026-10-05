---
bump: minor
---

### Added

- A shared, data-driven catalogue of importable browsers
  (`browser-sources.json`, byte-identical across the JavaScript, Python and
  Rust packages) covering Chrome and its Beta/Dev/Canary channels, Edge
  channels, Brave variants, Chromium, Opera and Opera GX, Vivaldi, Arc, Yandex,
  and Firefox with its LibreWolf, Waterfox, Zen, Floorp, Developer Edition and
  Nightly forks. It records each browser's per-platform profile roots, Chromium
  Safe Storage identity, and operating-system default identifiers.
- Resolution of the operating-system default web browser (macOS LaunchServices,
  Linux `xdg-settings`/`xdg-mime`, Windows `UserChoice` ProgId) to a catalogue
  id, so `default`/`auto` imports follow whichever browser a person actually
  uses.
- Profile discovery and migration classify a browser's engine family from the
  catalogue, so every catalogued Chromium variant and Firefox fork is
  recognised, and reading cookies honours a custom user-data directory.
- Listing of the browsers and profiles that hold cookies — optionally for
  specific domains — as names and counts only, never values.
