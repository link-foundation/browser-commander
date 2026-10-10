# Research and implementation decisions

## Navigation, cancellation, and tab selection

[Playwright Page API](https://playwright.dev/docs/api/class-page) documents distinct DOMContentLoaded, load and network-idle states and discourages network idle as a general readiness signal. Keep the existing default for compatibility, but route early triggers through lifecycle events and expose readyOn on explicit readiness waits. Reuse the existing monotonic deadlines rather than increasing timeouts. A click timeout with changed URL/session before dispatch must be interrupted, never successful: a manual submission cannot be attributed to an undispatched click.

Playwright-emulated visibility is unsuitable for selecting a tab after attachment (issue 145's observed focus-emulation behaviour). Chrome TargetInfo does not promise active-tab ordering. Prefer explicit targetId or URL matching and persist the automation target. A CDP implementation can disable focus emulation before sampling and must clean up its session. Do not silently close tabs: singleTab is explicit.

## Chrome panels and preferences

[Chromium SessionRestoreInfobar model](https://chromium.googlesource.com/chromium/src/+/7e55b90cb06c5d388283411090cc4514fc2c7485/chrome/browser/ui/views/session_restore_infobar/session_restore_infobar_model.h) has its own startup decision, separate from crash restoration. Disable SessionRestoreInfobar in no-crash-restore. Seed translate.enabled=false in addition to the feature switch; keep custom switches combined with the existing mergeFeatureSwitches implementation.

[Chromium tracked preferences](https://chromium.googlesource.com/chromium/src/+/fb473a87fb9a0cb77a70811505929ba08c580e74/chrome/browser/prefs/chrome_pref_service_factory.cc) explicitly tracks restore-on-startup and other sensitive settings. Warn before writing known protected settings and explain that editing Preferences cannot create valid MACs in Secure Preferences. Supported alternatives are browser settings or managed policy; do not synthesize MACs.

## Capture and encoding components

[Playwright screenshot API](https://playwright.dev/docs/api/class-page) offers animations/caret/scale/style and video configured on browser contexts. [Playwright videos](https://playwright.dev/docs/videos) requires context closure to flush videos. Native recordVideo therefore cannot implement arbitrary start/stop on an already attached context alone. A bounded screenshot-sequence recorder is portable, including WebDriver, and CDP screencast can improve Chromium throughput.

[gifenc](https://github.com/mattdesl/gifenc/blob/main/README.md) is a small pure-JavaScript GIF encoder with palette quantisation. [UPNG.js](https://github.com/photopea/UPNG.js/) decodes PNG and encodes APNG from RGBA frames without invoking binaries. [webp-wasm](https://github.com/jhuckaby/webp-wasm) encodes static WebP through WebAssembly/libwebp. Animated WebP uses these encoded frames and the [official WebP RIFF container](https://developers.google.com/speed/webp/docs/riff_container). APNG uses an explicit container because UPNG truncated very small frames in the reproducer. Python uses [Pillow](https://pillow.readthedocs.io/en/stable/handbook/image-file-formats.html), which supports GIF, APNG and WebP sequences. These are better Node-side candidates than reimplementing image codecs. [ffmpeg.wasm installation](https://ffmpegwasm.netlify.app/docs/getting-started/installation/) explicitly supports browsers only, so it is not a drop-in Node encoder. An optional system ffmpeg backend can cover mp4/webm/mov; missing codecs must produce typed unsupported errors rather than mislabeled output.

## Trace and persistence approaches

Extend existing bundle/schema/Links Notation readers and generated browser assets. Snapshot cloning with cloneNode avoids Trusted Types sinks; recurse through shadow-root descendants so live state and redaction survive. Network events share the recorder's ordering/redaction/retention pipeline and generate HAR from those same records. Drain async response-body tasks before stop. Body capture remains opt-in and bounded; cookie, authorization, proxy-authorization and set-cookie are redacted.

Persistent launch needs a detached browser process and watchdog, profile/port identity, atomic metadata updates and a lease preventing concurrent launch. A controller disconnect and Browser.close are different actions. Reuse existing executable resolution/restriction/profile helpers rather than making an independent launcher with different defaults.

Rust uses [gif](https://docs.rs/gif/latest/gif/) and [png](https://docs.rs/png/latest/png/) for native animation output. [image WebPEncoder](https://docs.rs/image/latest/image/codecs/webp/struct.WebPEncoder.html) supports lossless encoding; lossy quality gets an explicit capability error. [webp](https://docs.rs/webp/latest/webp/struct.Encoder.html) is an alternative with libwebp build dependencies. The complete inventory and plans are in [issue-146-analysis.md](../../docs/issue-146-analysis.md).
