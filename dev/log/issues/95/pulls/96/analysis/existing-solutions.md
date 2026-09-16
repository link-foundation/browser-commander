# Existing solutions

What already exists for each of the three problems, and whether this branch
reuses it. Where a library solves the problem well, the design follows it;
where it cannot be reused, the reason is recorded here so the decision is not
re-litigated later.

---

## #94 — Links Notation

### links-notation (adopted)

The notation the issue names, published by the same foundation and released in
all three of this repository's ecosystems at the same version:

| Ecosystem | Package          | Version used |
| --------- | ---------------- | ------------ |
| npm       | `links-notation` | `^0.20.0`    |
| PyPI      | `links-notation` | `0.20.0`     |
| crates.io | `links-notation` | `0.20.0`     |

**Adopted** as the export's formatter and as the proof that the export is
portable. The JavaScript package supplies `Parser` and the formatter used by
`formatTraceLinks()`; the Python package supplies `StreamParser` /
`parse_chunks`, which `experiments/trace-links-export.mjs` uses to read a
JavaScript-written export back in 4 KiB chunks. That a second language's
implementation of the notation reconstructs the timeline is the reason the
export can be called portable rather than merely textual.

**What it does not do, and what this branch adds around it.** The formatter
chooses a quote character the value does not contain, and the parser processes
no escape sequences at all. Two consequences matter for a trace, because a
trace records whatever the page contained:

- a value holding both `'` and `"` has no valid quoting and is silently
  corrupted on the way back;
- a value holding a real newline breaks the one-link-per-line framing that
  makes the export streamable.

`encodeLinkText`/`decodeLinkText` in `js/src/traces/links.js` escape exactly
those cases and nothing else, so ordinary values stay readable in a text editor
while pathological ones survive the round trip. Both directions are tested,
including `first line\nsecond line`. This is a gap in the library, not in the
notation; if 0.21 processes escapes, the encoder can narrow accordingly, and
the golden test will say so loudly when the emitted bytes change.

**Why the exporter lives only in JavaScript.** Only the JavaScript package
records traces — Python and Rust read bundles. Adding a notation dependency to
the readers would buy nothing today and would triple the surface that the
golden test pins. The portability claim is instead proved from the outside, by
reading the export with a different language's parser.
`docs/feature-parity.md` states this explicitly rather than leaving the reader
to infer it from an absence.

### Alternatives considered

| Option                                  | Why not                                                                                                                                                                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hand-rolled emitter for the same syntax | The point of the issue is a _supported_ export; a private re-implementation of somebody else's grammar drifts from it silently. The library is the spec.                                                                     |
| NDJSON with a links-shaped payload      | The bundle is already NDJSON. A second JSON view would not give the semantic, actor-aware, link-per-fact shape the issue asks for.                                                                                           |
| RDF/Turtle or JSON-LD                   | Solves the same "portable graph of facts" problem and has far more tooling, but it is not the notation the issue specifies and it pulls a large dependency for a file that has to stay cheap to append to during a live run. |

---

## #93 — Continuous session replay

### Playwright Trace Viewer (studied, not reused)

Playwright's own tracing records DOM snapshots plus an action log and replays
them in a viewer — the closest prior art to what this repository's trace bundle
does, and the source of two design decisions here:

1. it records a **base snapshot before anything happens**, which is what
   `initialCheckpoint` now does by default in continuous mode;
2. it is honest that the viewer is a _reconstruction_, not a re-execution —
   the same wording the manifest's `replay` block and the viewer header now
   carry.

Not reused directly because the bundle must be engine-neutral (Puppeteer and
CDP-only runs produce the same bundle) and readable from Python and Rust, which
Playwright's trace format is not designed for.

### rrweb (studied, not reused)

The reference implementation of incremental DOM recording. It confirms the two
mechanics this branch implements: reinstalling observers from a new-document
hook so the recorder precedes application scripts, and recording control state
(`value`, `checked`, `selected`, focus, scroll) as its own event type, since
those never appear in a `MutationObserver` — which is precisely gap 3 of #93.
Its child-list encoding — a node's `previousSibling`/`nextSibling` at insert
time — is what `R2.4` follows.

Not adopted as a dependency: rrweb owns the whole recording and playback stack
and its own serialization format, while this repository already has a bundle
format that three languages read and that the CDP layer feeds. Vendoring a
second format would leave the two out of step.

### CDP `DOMSnapshot`/`DOM.getDocument` polling (rejected)

A checkpoint-only design already exists and is exactly what #93 says is
insufficient. Polling more often costs more and still loses everything between
polls.

---

## #92 — Download completion races

There is no library for this; the mitigations are known patterns, and the
branch combines two of them.

| Pattern                                                 | Used? | Note                                                                                                                                                                                                                              |
| ------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wait for the `.crdownload`/`.partial` sibling to vanish | yes   | A partial sibling means the bytes are not final, whatever the event said.                                                                                                                                                         |
| Require the size to be stable across two observations   | yes   | The same technique this repository's Rust download watcher already uses — which is why Rust never had this bug.                                                                                                                   |
| Retry the read on `ENOENT` only                         | no    | Hides a genuinely absent file behind a retry loop; the branch waits for a described condition instead.                                                                                                                            |
| Trust `Browser.downloadProgress` `completed`            | no    | That is the reported defect: the event can precede the directory entry being observable.                                                                                                                                          |
| Switch to `behavior: "allow"` and watch the directory   | no    | It is what Rust does and it works, but `allowAndName` is what gives the JavaScript and Python sources a stable GUID to correlate an artifact with the request that caused it; losing that to fix a timing bug is the wrong trade. |

Chromium's own issue tracker documents the ordering — the completion
notification is emitted from the download manager, not from the filesystem, so
a caller that opens the path on the event is racing it. The fix therefore
belongs on the consumer side, which is where it is.
