---
bump: minor
---

### Added

- Typed Puppeteer from Rust: `browser_commander::puppeteer` starts the JavaScript CLI's `serve --stdio` bridge and has a struct for every Puppeteer class and interface, with an `async fn` for every method and getter, own and inherited. `scripts/generate-puppeteer-bindings.mjs` generates them from puppeteer-core's `lib/types.d.ts`.
