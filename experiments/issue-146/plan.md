# Issue 146 implementation and verification plan

All six child issues and their comments were read on 2026-10-10. A later comment
on issue 142 added the stable-viewport requirements below during final review.
Work is confined to branch issue-146-c162424fb5ec and existing PR 147.

1. [x] Read issues 140–146, PR conversation, inline reviews, review decisions, repository guidance and recent merged PRs.
2. [x] Research primary documentation and existing components; record choices and alternatives below.
3. [x] Write minimal failing regressions before fixing each bug; retain experiments here and useful demonstrations in examples.
4. [x] Implement every requirement across JS, Python, Rust, engine adapters, CLI and generated shared assets.
5. [x] Run focused regressions, all local unit tests, real-browser checks, lint/format/type checks, shared-asset checks and release checks; preserve large logs in ci-logs.
6. [x] Commit independent passing increments; add release fragments using the existing release workflow, which owns version changes.
7. Finalization: fetch/include the default branch, review the entire PR diff, push only the prepared branch and update PR title/body with evidence and all seven closing references.
8. CI finalization is tracked on PR 147: list runs with timestamps and SHAs, download every failed run, diagnose exact errors, fix and verify. Wait for background tasks and CI. Mark the PR ready only when complete.

## Complete requirement inventory and implementation choices

### 140: tracing, reusable browser and convenience APIs

- [x] Optional DOM snapshots AND mutations in Links Notation: extend the existing trace exporter instead of introducing another trace format.
- [x] Text-only DOM links with added/removed visible text, changed attributes and selector paths: filter shared mutation records in exporter.
- [x] Request/response events with method, URL, status, resource type, content type and timing in bundle and links.
- [x] Network resource-type and URL-pattern filters.
- [x] Opt-in document/xhr/fetch bodies, bounded capture and default cookie/authorization/set-cookie header redaction.
- [x] HAR export of the same recorded data.
- [x] Trusted Types-safe checkpoints: DOM cloning, including recursively redacted open shadow roots; no innerHTML assignments.
- [x] Persistent connect-or-launch browser, fixed port, matching userDataDir, survives controller exit, keepOpen and idle timeout.
- [x] Distinct session.close() and session.detach(), remembered page and commander.reusePage().
- [x] One-flag debug/output or BROWSER_COMMANDER_TRACE: interaction/navigation/error/network/text/checkpoint recording, links and HAR.
- [x] trace summarize CLI with from/to/grep filters and a merged timeline.
- [x] Continuous trace selector ignore list, byte cap/rotation and gzip.
- [x] count({selector, visible:true}).
- [x] Trigger concurrency skip/restart without simultaneous form handlers.
- [x] Configurable known-overlay dismissal before interactions.

### 141: quiet Chrome UI and safe profile seeding

- [x] Disable SessionRestoreInfobar by default in no-crash-restore.
- [x] no-translate seeds translate.enabled=false.
- [x] resolveRestrictions disableFeatures and launchBrowser disableFeatures merged into ONE deduplicated switch, including caller args.
- [x] Detect protected Chrome preferences and warn or throw; document known protected paths and supported alternatives.
- [x] quiet-ui group suppresses restore/crash, translation, default-browser, passwords/cards, automation banner, promos and what's-new.

### 142: capture across all engines/languages

- [x] Later comment: expose stable-viewport capture in JS/Python/Rust/CLI; use native-view CDP and bounded viewport-only engine fallbacks.
- [x] Reject modes that reposition or restyle the visible page; document full-page compositor side effects and platform limits.
- [x] Reproduce missing-mode/validation failures before implementation; add displayed-window pixel sampling plus intermediate geometry and viewport-image decode checks to CI.

- [x] Typed unified screenshot options: path, fullPage, selector/element, clip, png/jpeg/webp, quality, css/device scale, transparency, animations and caret; bytes/file result; typed unsupported errors.
- [x] Typed Rust Engine screenshot options and Python public API.
- [x] Session recording start/stop: webm/mp4/mov, fps, size, quality. Native recording where available; frame fallback or explicit unsupported errors otherwise.
- [x] GIF/APNG/animated WebP from recordings or screenshot sequences: fps, scale, palette/dither, loop, optimisation. No external binaries by default; optional ffmpeg.
- [x] trace render gif/apng/webp/mp4/webm/sheet with fps/from/to/scale, checkpoint screenshot source and optional startTrace video.
- [x] CLI screenshot options, record start/stop, gif and trace render available from JS/Python/Rust.
- [x] Document and verify no injected live-page markers; any action overlays are recording-only; viewer outlines stay offline.
- [x] clean-capture options hideScrollbars/hideCaret/disableAnimations/waitForFonts, unsupported options explicit.

### 143: trigger readiness

- [x] Per-trigger readyOn urlchange/domcontentloaded/load/networkidle, preserving networkidle default.
- [x] Configurable global network-idle timeout and waitForPageReady readyOn support.
- [x] Lifecycle event routing must start early triggers without waiting for network idle and remove listeners on destroy.

### 144: navigation during waits

- [x] Reproduce clickButton wait timeout after URL or navigation session changes.
- [x] Return interrupted/navigated result when timeout coincides with navigation, including same-URL document replacement by session id.
- [x] Keep true timeouts as errors; inspect analogous click/fill/wait paths in all languages.

### 145: deterministic tab reuse

- [x] Stop treating Playwright-emulated visibility as actual tab selection.
- [x] Resolve actual focused tab before attachment where possible; never infer active state from /json/list ordering.
- [x] targetId and URL matcher selection, remembered automation target and best-effort foreground detection.
- [x] Explicit singleTab closes other tabs only when requested; apply selection to all language connectors and Node bridges.

## Research and alternatives

See [the complete requirement-by-requirement research](../../docs/issue-146-analysis.md) and [API guide](../../docs/capture-and-debugging.md). Related merged work: PR 139 (navigation/session APIs), PR 111 (profile preferences), PR 96 (traces), PR 125/127 (WebDriver/Safari).
