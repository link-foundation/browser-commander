---
bump: minor
---

### Added

- Native trace recording (issue #108): `start_trace` records the same portable trace bundle JavaScript's `startTrace()` writes, record for record, with the same modes (mutations stream between checkpoints in `continuous` mode), the same redaction, size limits, dropped-record accounting and strict mode. `TraceRecorder` names checkpoints, records custom events, wraps interactions with `traced`, and stops once, optionally recording the error a run ended with or discarding the bundle.
- `write_trace_viewer` writes the same offline `viewer.html`, and `trace_links`/`write_trace_links` (or `TraceOptions::links` while recording) write the same Links Notation export. A conformance test holds the Rust output byte-for-byte to the JavaScript golden trace.
- The chromiumoxide adapter now supports init scripts and reports navigations, console output, page errors, failed requests and dialogs to a running trace. `EngineAdapter` gains `add_init_script`, `remove_init_script` and `trace_events`, with defaults that do nothing.
- `record_scenario` keeps a run's trace only when the run fails, the Rust counterpart of the JavaScript runner's `trace: 'retain-on-failure'` and Python's `traced()`: a failing run leaves its bundle, ending in a `failure` checkpoint with the offline viewer written next to it, and a passing run leaves nothing. `on` and `on-first-retry` are accepted too.
