//! rust/tests/puppeteer_bridge.rs against the harness build of the crate.
//! Run with: BROWSER_COMMANDER_JS_CLI=$PWD/../../js/bin/browser-commander.js
//! CARGO_TARGET_DIR=/tmp/pw-harness-target cargo test --test
//! puppeteer_smoke -- --ignored

extern crate playwright_harness as browser_commander;

#[path = "../../../rust/tests/puppeteer_bridge.rs"]
mod puppeteer_bridge;
