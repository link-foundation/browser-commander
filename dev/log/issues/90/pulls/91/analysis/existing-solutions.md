# Existing solutions surveyed

Before designing anything, I looked at what the ecosystem already does for each
of the three problems. Where a library solves the problem well, the design
follows it; where it cannot be reused, the reason is recorded here so the
decision is not re-litigated later.

---

## Traces (#87)

### Playwright Trace Viewer — the closest prior art

Playwright records a trace as a **single `.zip`** containing newline-delimited
JSON event records plus content-addressed resources named by SHA-1 hash, with
DOM snapshots captured before and after each action.

What the design takes from it:

- one bundle per session, self-describing, with a schema version;
- NDJSON for the event stream, so a truncated recording is still readable up to
  the last complete line — which is exactly the "partial trace" robustness #87
  asks for;
- content-addressed resources, so repeated assets are stored once.

Why it is not simply adopted:

1. **The viewer is not offline.** `npx playwright show-trace` starts a local
   server, and `trace.playwright.dev` is a hosted page. #87 requires opening a
   trace "locally with no server."
2. **It is engine-locked.** The format is Playwright's internal contract, it
   changes between versions without a stability guarantee, and Puppeteer,
   Selenium and Chromiumoxide cannot produce it. Browser Commander must record
   the same trace from every engine in three languages.
3. **Redaction is absent.** Playwright traces capture request and response
   bodies and full DOM, including password field values. #87's central
   requirement — redact before bytes reach disk — has no hook in that pipeline.

**Decision:** keep the structural ideas (zip-compatible bundle, NDJSON, content
addressing, before/after snapshots); do not depend on the format or the viewer.

### rrweb — the session-replay model

rrweb is the reference implementation of DOM session replay: one **full
snapshot** of the document, then **incremental mutation deltas** from a
`MutationObserver`, tied together by an integer-id "mirror" map so a mutation
can name a node that was serialized earlier. FullStory, Microsoft Clarity,
LogRocket, PostHog and Sentry Session Replay are all built on this two-phase
design; PostHog and Sentry embed rrweb directly.

Relevant to #87 beyond the data model:

- **Masking happens in the page, before transmission** — rrweb masks input
  values and text at serialization time rather than scrubbing afterwards. This
  is the design #87 requires ("redaction applied before bytes reach disk"), and
  for the same reason: data that is never serialized cannot leak from an
  artifact, a log or a crash dump.
- **Opt-out attributes** (`data-rrweb-ignore`, `.rr-block`) show that a
  selector list alone is not enough; page authors need a way to mark subtrees.
  Our `privacy.redactSelectors` plays that role and defaults to
  `input[type=password]` and `[data-private]`.
- **Recording is best-effort.** rrweb never fails the host application because
  recording failed — matching #87's "non-fatal unless strict mode."

Why rrweb is not a dependency:

1. It records from **inside** the page, which means injecting a bundle into
   every frame of every page under automation — a large, visible footprint that
   changes the behavior of the thing being tested.
2. Its replayer is a browser application with its own runtime; #87 wants an
   inert viewer that renders untrusted HTML with scripts disabled.
3. It is JavaScript-only, and the format must be readable from Python and Rust.

**Decision:** adopt the snapshot + ordered-mutation-batch model and the
mask-at-capture principle; implement capture with a small injected
`MutationObserver` rather than the rrweb runtime.

### Semantic state versus serialized HTML

Both rrweb and Playwright had to solve the same problem we do: `outerHTML` does
not contain what the user typed. `value`, `checked`, `selected`, focus and
scroll offsets are live properties, not attributes. Playwright's snapshotter
writes them back into the markup as attributes; rrweb records them as
properties. #87 asks for them "separately from HTML serialization," which is the
cleaner of the two — a checkpoint's `state.json` can be diffed on its own, and
the HTML stays a faithful serialization rather than a doctored one.

---

## Downloads (#88)

### Playwright's download API

Playwright exposes downloads as a `download` event carrying a `Download` object
with `suggestedFilename()`, `path()`, `saveAs()`, `failure()` and `cancel()`.

What it gives us: suggested filename, a completion signal, and failure
reporting — most of the metadata #88 requires.

What it does not give us, and #88 explicitly requires:

- **Persistence.** Downloads are deleted when their browsing context closes
  unless the file is moved with `saveAs()`. #88's `persist: true` is
  implemented by calling `saveAs()` on completion.
- **A manual download in an attached browser.** The `download` event fires for
  contexts Playwright owns.
- **Collision policy, sanitization, validation, checksums.** All caller-side.

### CDP `Browser.setDownloadBehavior`

For attached Chromium — Puppeteer over CDP, and `connectBrowser()` — the
protocol-level API is:

- `Browser.setDownloadBehavior` with `behavior: 'allowAndName'`, a
  `downloadPath`, and `eventsEnabled: true`;
- `Browser.downloadWillBegin` → `{guid, url, suggestedFilename}`;
- `Browser.downloadProgress` → repeated, with the final call carrying
  `state: 'completed'` or `'canceled'`.

This is the only mechanism that observes a **human clicking a link in a visible
attached browser**, which #88 requires. `allowAndName` writes files named by
GUID, which is precisely the "UUID-like name with no extension" case the issue
calls out — the real name must come from `downloadWillBegin`'s
`suggestedFilename`, and the extension from the declared or sniffed MIME type
when even that has none.

Puppeteer's own `Page.setDownloadBehavior` helper is per-page and does not emit
events, so the manager uses the browser-level CDP call directly.

### Why not an existing download-manager library

Node has mature download libraries (`got`/`download`, `node-downloader-helper`),
but they all fetch a URL themselves over HTTP. A browser download carries the
page's cookies, session state, `Content-Disposition` header and sometimes a
`blob:` URL that has no server-side existence at all. Re-fetching the URL from
Node is a different request that can 403, return different content, or not exist.
The file must come from the browser.

What is reused rather than reimplemented: `node:crypto` for checksums,
`node:fs/promises` `rename()` for the atomic move (same-filesystem rename is
atomic on POSIX and on Windows when the target does not exist), and `mode:
0o600` / `0o700` for owner-only permissions.

### Naming and traversal

The sanitization rules follow the same conservative shape used by
`sanitize-filename` and by browsers themselves: strip path separators and
control characters, reject reserved names, reject `..` segments, and — the part
a filename sanitizer cannot do — resolve the final path and assert it is still
inside the configured root before opening it for writing. A page-supplied name
is untrusted input; the root check is what actually enforces the boundary.

---

## Readiness and click truthfulness (#89)

### Prior art for readiness

Playwright's `waitForLoadState('networkidle')` is **discouraged by its own
documentation** in favor of web-first assertions, precisely because "no requests
for 500 ms" is a poor proxy for "the application is ready." Testing Library's
`waitFor` and Cypress's retry-ability take the other approach: retry an
assertion the caller supplies until it holds or the deadline expires.

#89's proposed check list (`urlStableFor`, `networkIdleFor`, `domStableFor`,
`visibleImages`, `predicate`, consecutive stable samples) is the second model
with named, composable primitives — and `predicate` is the escape hatch that
makes the set complete for SPAs that no built-in check can describe.

The **monotonic deadline** requirement is standard practice: `performance.now()`
is monotonic, `Date.now()` is not, and a wall-clock adjustment mid-wait can
silently extend or collapse a budget. Go's `context.WithDeadline` and Rust's
`tokio::time::timeout` both work this way — one deadline created at the top,
passed down, each stage getting only what remains.

### Prior art for truthful results

There is no library to adopt here; this is a correctness fix. The relevant
principle is the one distributed systems call **honest failure reporting**: a
timeout is not a success, and an unobservable outcome is its own state, not a
default to the optimistic one. The three-valued `effect` (`confirmed` /
`not-observed` / `contradicted`) exists so that "I could not tell" has somewhere
to go other than `true`.

The click-without-scrolling technique — measure `getBoundingClientRect()`,
hit-test the centre with `document.elementFromPoint`, then dispatch
`page.mouse.click(x, y)` — is how Playwright's own `_clickablePoint` works
internally, minus the `scrollIntoViewIfNeeded` call that precedes it. Removing
that one step is what makes `scroll: 'none'` real: `page.mouse.click` takes
viewport coordinates and has no element to scroll to.

**Decision:** no new dependency. `performance.now()` for deadlines,
`page.mouse.click` for the no-scroll pointer path, and an explicit result model.
