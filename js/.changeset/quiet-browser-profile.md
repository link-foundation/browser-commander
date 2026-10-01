---
'browser-commander': patch
---

Suppress Chromium's default-browser prompt through profile settings on fresh and snapshot launches, and expose configurable Preferences and Local State values.

Update the locked brace-expansion dependency to 5.0.12 to resolve its CPU and stack exhaustion advisories.

Retry transient Windows credential-lock EPERM within the existing bounded deadline, preserving the underlying error when contention persists.

Accept a `monotonic` clock in `startTrace` and use the injected `now` for interaction durations, so a trace recorded with a fixed clock is byte-for-byte reproducible; the Python and Rust recorders are checked against such a recording.

Escape recorded text in the offline trace viewer. A recorded page's URL, title, form control values and event fields were inserted into the viewer as HTML, so a page could run script in the viewer of whoever opened its trace.
