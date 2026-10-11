# Trace privacy, sessions, and trigger migration

The [issue 160 investigation](issue-160-analysis.md) lists all requirements,
upstream research, alternatives, and verification. These options apply to the
existing APIs; Python uses snake_case names and Rust uses typed option fields.

## Trace budgets and continuous recording

Mutation targets, parents, and previous/next siblings contain paths and compact
identity fields. Added and removed nodes retain bounded markup needed for replay.
The recorder avoids serializing a large parent once for every appended child.

Default budgets are 256 MiB per bundle, 32 MiB per resource, 32 MiB per event,
4 MiB of HTML per snapshot, 4 MiB of mutations per checkpoint interval, and
5,000 queued in-page mutation batches. `limits.maxHtmlBytes` and
`limits.maxMutationBytes` adjust the latter byte budgets. HTML and mutation
truncation are marked explicitly. A new checkpoint starts a fresh mutation
interval; a full interval does not disable later intervals.

Continuous mode keeps the usual bundle layout until its bundle budget is
reached, then moves completed data into retained segments and continues.
Explicit rotation starts with segments immediately:

```javascript
const trace = await commander.startTrace({
  output: './trace',
  mode: 'continuous',
  limits: {
    rotate: { maxBytes: 32 * 1024 * 1024 },
    maxHtmlBytes: 4 * 1024 * 1024,
    maxMutationBytes: 4 * 1024 * 1024,
  },
  links: { output: './trace/trace.lino', dom: 'full' },
});
await trace.checkpoint('review');
await trace.stop();
```

Rotation happens before the next write would exceed a nonempty segment.
A checkpoint and its timeline record stay together. A single item may exceed
`maxBytes`, subject to the independent resource/event caps. A mutation segment
carries its base checkpoint. All segments are retained by default. Set
`maxSegments` explicitly to delete older segments (1–100); Rust uses
`RotationOptions.max_segments = 0` for unlimited retention. `limits.gzip`
compresses members at stop. `path` remains the root, `currentPath` identifies
the active segment, and `segments` lists retained segments. The normal handle's
checkpoint, event, links, stop, and stopped state remain available.

## Privacy before persistence

Hidden and password inputs are redacted by default. Sensitive meta content,
credential headers, query/fragment parameters, nested JSON fields, URL-encoded
forms, multipart fields, and embedded token assignments are scrubbed before
writing. Names containing password, token, csrf, xsrf, otp, secret, API key,
or authorization receive the default marker. Extra selectors, patterns, and
`privacy.redact` callbacks apply to HTML, mutation batches, and network text.

Textual response bodies use UTF-8 and retain original byte size; binary payloads
are omitted. Body capture is opt-in and defaults to a 1 MiB cap. HAR accepts the
UTF-8 records and legacy base64 records. Bundle and links writers consume the
same redacted records. Incremental DOM links read only newly written members
and retain only the current mutation member and read offset. `privacy.useDefaults: false` explicitly
disables the default field/selector rules; caller rules remain active.

## Attached and persistent browsers

```javascript
const session = await connectOrLaunch({
  engine: 'playwright',
  userDataDir: './dedicated-profile',
  remoteDebuggingPort: 9222,
  idleTimeoutMs: 30 * 60 * 1000,
  adoptExisting: true,
  closeNewTabs: true,
  urlMatchers: [/application/, 'about:blank'],
});
// Detach leaves the owned browser available for the next controller.
await session.detach();
```

Adoption is opt-in and verifies the running process's dedicated profile and
fixed debugging port before creating ownership metadata. Existing metadata
must match profile, port, and browser WebSocket identity. Heartbeats refresh
activity while a controller remains attached, including idle controllers.
They stop on detach. `closeNewTabs` enforces the selected tab beyond connection
setup and removes its listeners/tasks at detach. JS/Python enforce page events;
Rust's worker enforces it on heartbeat (at most 30 seconds apart).

Remembered targets are preferences. A missing remembered target falls back to
ordered `urlMatchers`, then a visible page, then the first page, then a new page
in the existing default context. Explicit `targetId` remains strict unless
`fallback: true` is supplied. JS/Python accept strings, regular expressions,
and predicates; Rust's typed matcher list contains URL strings. Connections
are detached when selection, restoration, or lifecycle initialization fails.
An explicitly supplied URL list takes precedence over an implicit remembered
target, even while that target is still open. During reuse, pass `urlMatchers`
in JavaScript, `url_matchers` in Python, or call Rust's
`reuse_page_matching(None, ordered_urls)`.

`connectBrowser({ noDefaults: true })` forwards Playwright's context override
option; explicit `false` is preserved. With the option omitted, only the exact
`Browser.setDownloadBehavior` / unsupported-context failure retries with
`noDefaults: true`. Other errors remain errors. A zero-page browser receives a
page in its existing default context, preserving profile and browser ownership.
CLI `--no-defaults` maps to the same option.

## Trigger migration from JavaScript 0.27 to 0.28

The 0.28 default `concurrency: 'skip'` is a breaking change: readiness events
arriving while an action runs are skipped. Set `concurrency: 'queue'` to retain
one latest matching start, or `concurrency: 'restart'` to request stop and retain
the replacement. JavaScript uses one action slot; Python uses one per trigger.
Queued starts are bounded and canceled by navigation, unregister, or destroy.
A DOM-ready start received during stop is preserved, including after the
10-second stop grace expires. Grace expiry never authorizes overlapping the
still-running action; the pending start runs when that action settles.

```javascript
commander.pageTrigger({
  name: 'application-ready',
  condition: ({ url }) => url.includes('/application'),
  readyOn: 'domcontentloaded',
  concurrency: 'queue',
  action: async (ctx) => {
    ctx.checkStopped();
  },
});
```

`readyOn` supports `urlchange`, `domcontentloaded`, `load`, and `networkidle`
(default). Python accepts `ready_on`. Rust does not expose page triggers; use
its documented event subscriptions. Superseded `net::ERR_ABORTED` navigation
is recognized as interrupted, allowing existing recovery policies to apply.

## Overlay dismissal and public trace tools

```javascript
const commander = makeBrowserCommander({
  page,
  overlays: [{ selector: '.consent-close', timeout: 1000 }],
  onOverlayDismiss: (report) => console.log(report.selector, report.status),
});
```

Dismissal selects the first visible match, has a finite timeout, and reports
`absent`, `dismissed`, or `error` with selector and error context. Dismissal and
reporting failures do not prevent the requested interaction. Python uses
`on_overlay_dismiss` and retains its list of dismissed selectors. Rust exposes
`dismiss_overlays_with_report` and `OverlayReport` while retaining the original
helper's return type.

JavaScript exports `renderTrace` and `summarizeTrace` from `browser-commander`
alongside existing trace tools. The installed READMEs link to repository guides.
