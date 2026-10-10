# Capture, debugging and reusable sessions

The screenshot facade returns bytes and optionally writes those bytes to `path`.
Use `selector` (or an engine element in JS/Python), `clip`, or `fullPage`, one at
a time. PNG is the default; JPEG/WebP quality is 0–100. Unsupported engine
options raise `UnsupportedCaptureError` in JS/Python or `EngineError::Unsupported`
in Rust. No option silently changes the requested output format.

```js
const png = await commander.screenshot({
  selector: '#application',
  format: 'png',
  scale: 'css',
  hideScrollbars: true,
  hideCaret: true,
  disableAnimations: true,
  waitForFonts: true,
});
const recording = await commander.startRecording({
  output: './application.webm',
  format: 'webm',
  fps: 10,
  size: { width: 640, height: 480 },
  maxDurationMs: 30_000,
});
// Drive the existing page.
const movie = await recording.stop(); // repeated stops share the result
```

Run [the complete recording example](../examples/capture-session.mjs) to capture
a short GIF from an existing commander page.

Python exposes `ScreenshotOptions`, `screenshot`, `start_recording` and
`encode_animation` from `browser_commander`; option names use snake_case.

```python
from browser_commander import ScreenshotOptions, screenshot, start_recording
image = await screenshot(page, options=ScreenshotOptions(selector="#application"))
recording = await start_recording(page, format="gif", fps=5, max_frames=20)
animation = await recording.stop(path="application.gif")
```

Rust exposes `capture::{ScreenshotOptions, screenshot, RecordingOptions,
start_recording, encode_animation}` and `EngineAdapter::screenshot_with_options`.
The legacy no-options adapter screenshot method remains available.

```rust
use browser_commander::capture::{screenshot, ScreenshotOptions};
let bytes = screenshot(page.as_ref(), &ScreenshotOptions {
    selector: Some("#application".into()),
    ..Default::default()
}).await?;
```

## Engine capabilities

| API/engine              | Screenshot                                                                     | Clean capture / CSS scale                                                        | Session movies                                                                               |
| ----------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| JS Playwright           | PNG/JPEG native, WebP library encoding; element/clip/full page                 | Native capture styles and scale; fonts can be awaited                            | Bounded sampling, browser WebM/MP4 when its MediaRecorder supports them                      |
| JS Puppeteer            | PNG/JPEG native, WebP library encoding; element/clip/full page                 | Temporary styles with finally cleanup; PNG/WebP CSS scaling                      | Bounded sampling and browser MediaRecorder                                                   |
| JS Selenium/Safari      | Viewport/element capture; advanced native capture requires BiDi                | Capability errors for unavailable operations; no transparency fallback           | Frame sampling; codec-dependent MediaRecorder or explicit unsupported error                  |
| Python Playwright       | PNG/JPEG native, WebP through Pillow                                           | Capture styles, scale and fonts                                                  | GIF/APNG/WebP, browser WebM/MP4                                                              |
| Python Puppeteer bridge | Typed native screenshot options; WebP through Pillow                           | Temporary styles; PNG/WebP CSS scaling                                           | Image/frame recording where adapter support is available; unavailable movies fail explicitly |
| Python Selenium         | Viewport/element/clip; PNG/JPEG/WebP through Pillow                            | CSS scaling; unsupported clean/full-page/alpha options fail explicitly           | Image/frame sampling; movies explicitly unsupported                                          |
| Rust Chromiumoxide      | Native PNG/JPEG/WebP, element clip/full page/PNG alpha                         | CSS scale with clip; clean styles and unclipped CSS scale explicitly unsupported | Image/frame recording; browser WebM/MP4 when supported                                       |
| Rust native Playwright  | PNG/JPEG; other capabilities checked explicitly                                | Native screenshot protocol options; WebP explicitly unsupported                  | Frame sampling and browser codec-dependent movies                                            |
| Rust Node bridge        | Uses the shared JS capture facade                                              | Matches the underlying JS engine                                                 | Matches the underlying JS engine                                                             |
| Rust native WebDriver   | PNG through the default typed adapter; advanced options explicitly unsupported | Explicit capability errors                                                       | Frame fallback; unavailable codecs explicitly unsupported                                    |

GIF/APNG/animated WebP encode in process: gifenc/UPNG/webp-wasm in JS, Pillow
in Python and native gif/png/image codecs in Rust. Rust animated WebP is lossless;
lossy quality requests are explicit unsupported errors. Palette/dither controls
apply to GIF; unsupported codec controls are rejected. Frame limits default to
1000 frames, 64 MiB compressed frame data and a 60-second recording. Encoders
also bound dimensions and decoded memory. FPS is the requested sampling rate;
slow engine screenshots can reduce the actual capture rate.

MOV requires an explicitly selected ffmpeg backend in the shared JS API/CLI;
Python's native movie API reports it unsupported. No external binary is needed
for GIF/APNG/WebP or a browser-supported WebM/MP4. Playwright context video alone
would require closing an existing context to flush it, so session recording uses
frame sampling without replacing the caller's page/context.

Captures never add live highlight, cursor or outline markers. The encoder canvas
is detached from the DOM. Clean-capture options are opt-in and temporary;
unsupported options fail explicitly. Viewer outlines belong only to the offline
viewer. Capturing does not opt into a recording-only action overlay.

## Persistent browser and tab selection

```js
import { connectOrLaunch, makeBrowserCommander } from 'browser-commander';
const session = await connectOrLaunch({
  userDataDir: './automation-profile',
  remoteDebuggingPort: 9322,
  idleTimeoutMs: 30 * 60_000,
});
const commander = makeBrowserCommander({ page: session.page, session });
await commander.reusePage(); // remembered target
await commander.destroy();
await session.detach(); // disconnect controller; browser/watchdog survive
// await session.close(); // terminate this owned browser instead
```

Python uses `connect_or_launch` and `PersistentSession` with `LaunchOptions`.
Rust provides `browser::persistent_session::PersistentOptions` and
`connect_or_launch`. Python/Rust persistence uses the companion npm watchdog;
native APIs reject unsupported persistent engines. Use a dedicated profile and
fixed port. Metadata is private, ownership checked, atomically updated and
guarded by a lease. JS/Python commander actions refresh activity; direct Rust
adapter users should call `session.touch()` for long-running work.

`connectBrowser` accepts `targetId`, `url` and `singleTab` (snake_case in
Python/Rust). JS accepts a string, regex or predicate URL matcher; Python also
accepts compiled patterns/callables; Rust uses exact strings. Explicit selectors
take precedence; a missing selector is an error. Persistent sessions remember
the automation target. Otherwise foreground detection disables focus emulation
before sampling. If visibility cannot identify a foreground page, the engine's
first page is the fallback; its order does not identify the active tab. Use an
explicit selector or a persistent session for reliable reconnection. Other tabs
are closed only when `singleTab` is requested.

## Debugging and continuous traces

`makeBrowserCommander({ page, debug: { output: './run.bc-trace' } })` or
`BROWSER_COMMANDER_TRACE=./run.bc-trace` starts managed continuous debugging in
JS/Python. Await `commander.ready` before driving the raw page directly and
`commander.destroy()` to finish exporters. Rust uses `TraceOptions::debug` and
explicit traced interactions. Debugging includes DOM text changes, interactions,
navigation checkpoints, console/page errors, network metadata, links and HAR.
Bodies remain opt-in.

For explicit JS tracing:

```js
const trace = await commander.startTrace({
  output: './run.bc-trace',
  mode: 'continuous',
  links: { output: './run.lino', dom: 'text' }, // or 'full'
  network: {
    resourceTypes: ['document', 'xhr', 'fetch'],
    urlPattern: '/api/',
    bodies: true,
    maxBodyBytes: 64 * 1024,
    har: true,
  },
  dom: { ignoreSelectors: ['iframe', '[id^="adfox"]'] },
  limits: { rotate: { maxBytes: 32 * 1024 * 1024, maxSegments: 4 } },
  gzip: true,
  // video: { format: 'webm', fps: 5 },
});
await trace.stop();
```

Network events require event support: JS Playwright/Puppeteer and available BiDi
events, Python Playwright, and native Rust Chromiumoxide. Unsupported native
network engines report capability errors. Credentials in cookie/authorization/
proxy-authorization/set-cookie headers are redacted by default. Bodies are limited
to document/xhr/fetch, bounded by bytes and deadlines. HAR derives from the same
events. Selector privacy also applies inside open shadow roots, including on
Trusted Types pages.

Python rotation uses the same `limits.rotate` keys and `limits.gzip`; Rust uses
`start_rolling_trace`/`RotationOptions` and `TraceOptions.gzip`. Rolling directories
contain `segments.json` and complete per-segment bundles, each with its own
links/HAR. Reader, summarize and render APIs accept the rolling directory.
Retention deliberately removes the oldest segments. A byte cap may drop an
individual oversized checkpoint; manifests report dropped/truncated capture.

## Readiness and interactions

`pageTrigger({ readyOn: 'domcontentloaded', concurrency: 'skip', condition,
action })` starts before network idle; other levels are `urlchange`, `load` and
the compatible default `networkidle`. Use `networkIdleTimeout` to configure
the navigation manager. Readiness waits accept the same `readyOn` values.
`restart` signals the old action to stop and awaits its completion before
starting the next handler. Actions should honor `ctx.isStopped()`.

`count({ selector, visible: true })` filters by rendered bounds and computed
visibility. Configure `overlays: ['#cookie-accept']` on a JS/Python commander
to click only known visible dismiss controls before interactions, or call
`dismissOverlays`/`dismiss_overlays` explicitly. Rust exposes
`interactions::dismiss_overlays(adapter, selectors)` for use before an action.
Navigation during an element wait
is distinguished from an ordinary timeout: click returns interrupted/navigated;
shared waits can raise navigation interruption or return null/false when allowed.

## Shared CLI

These commands work through the JS, Python and Rust CLIs:

```sh
browser-commander screenshot application.webp --selector '#application' --format webp --quality 80 --scale css --url https://example.com
browser-commander record start --out application.webm --format webm --fps 10 --max-duration-ms 30000 --url https://example.com
browser-commander record stop --out application.webm
browser-commander gif --frame first.png --frame second.png --out demo.gif --fps 5 --loop 0
browser-commander trace summarize run.bc-trace --from 17:56 --to 17:58 --grep popup
browser-commander trace render run.bc-trace --format gif --fps 5 --scale 0.5 --out run.gif
browser-commander trace render run.bc-trace --format sheet --out run.png
browser-commander launch --keep-open --user-data-dir ./automation-profile --remote-debugging-port 9322 --idle-timeout-ms 1800000
```

`--clip` and `--size` accept JSON objects. `record start` runs until a stop marker
or termination signal; run `record stop` in another process with the same output
path. In `serve --stdio`/`run`, use `record.start` and `record.stop` with a session.
Offline trace render uses checkpoint screenshots; optional trace recording stores
`recording.<format>` alongside them. Movie render launches a temporary headless
Playwright encoder page, or uses the caller's explicit ffmpeg backend.
