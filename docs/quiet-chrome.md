# Quiet Chrome sessions

Use `restrictions: ['quiet-ui']` in JavaScript, `restrictions=["quiet-ui"]`
in Python, or `LaunchOptions::default().restrictions(["quiet-ui"])` in Rust.
This group disables session-restore UI, translation, first-run/default-browser
checks, password/card saving, promotional tabs and the what's-new page. Browser
Commander normally omits the engines' automation switches; supplying
`--enable-automation` yourself can bring the automation banner back.

`no-crash-restore` includes `SessionRestoreInfobar`. `no-translate` both disables
the Translate feature and seeds `translate.enabled=false` before launch.
`disableFeatures` (`disable_features` in Python/Rust), named restrictions and
caller `--disable-features=...` arguments are deduplicated into one switch.
Caller preferences override restriction defaults.

Chrome protects some preference paths with installation-specific hashes. Browser
Commander warns when callers seed `session.restore_on_startup`,
`session.startup_urls`, `homepage`, `homepage_is_newtabpage`,
`browser.show_home_button`, `extensions.settings` or
`default_search_provider_data`. Writing these JSON keys does not recompute
Chrome's hashes, so Chrome may reset them. Open pages through navigation APIs,
use supported enterprise policies, or clone an existing profile with the profile
snapshot/migration APIs. Do not edit `Secure Preferences` to suppress restore UI;
use the feature restriction above.

Chrome feature names and UI behavior vary by release. The catalogue records the
requested switches and ordinary preferences; it does not patch Chrome or modify
the user's default profile. See Chrome's
[tracked preference implementation](https://chromium.googlesource.com/chromium/src/+/fb473a87fb9a0cb77a70811505929ba08c580e74/chrome/browser/prefs/chrome_pref_service_factory.cc).
