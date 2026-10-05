---
'browser-commander': minor
---

Add a shared catalogue of importable browsers and resolve the system default
(#114).

- `browser-sources.json` is a shared, data-driven catalogue of the browsers
  Browser Commander can import from — Chrome and its Beta/Dev/Canary channels,
  Edge channels, Brave variants, Chromium, Opera and Opera GX, Vivaldi, Arc,
  Yandex, and Firefox with its LibreWolf, Waterfox, Zen, Floorp, Developer
  Edition and Nightly forks. It records each browser's per-platform profile
  roots, Chromium Safe Storage identity, and operating-system default
  identifiers, and ships byte-identical to the Python and Rust packages.
- `browser: 'default'` (or `'auto'`) now resolves the operating-system default
  web browser (macOS LaunchServices, Linux `xdg-settings`/`xdg-mime`, Windows
  `UserChoice` ProgId) to a catalogue id, so an import follows whichever
  browser a person actually uses.
- Profile discovery and migration classify a browser's engine family from the
  catalogue instead of a hard-coded list, so every catalogued Chromium variant
  and Firefox fork is recognised, and reading cookies honours a custom
  `userDataDir`.
- New `cookies sources` and `profile sources` commands (and the
  `cookies.sources`/`profile.sources` JSON-RPC methods) report which browsers
  and profiles hold cookies — optionally for specific `--domain`s — as names
  and counts only, never values.
- A `default`/`auto` migration scoped to `domains` falls back from a default
  browser that holds no cookies for them to the installed profile holding the
  most, and reports which one with a `default-browser-fallback` warning
  (`resolveImportSource`). Migrating from Opera or Opera GX now reads their
  single profile from the user data directory itself.
