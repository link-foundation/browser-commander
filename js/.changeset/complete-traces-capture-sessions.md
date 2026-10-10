---
'browser-commander': minor
---

Add portable screenshots, bounded recordings and GIF/APNG/WebP encoding, trace
rendering and summaries, full/text DOM links, bounded redacted network/HAR,
continuous trace rotation/gzip, and detached reusable browser sessions with idle
shutdown. Add early trigger readiness, explicit trigger concurrency, visible
counts and configured overlay dismissal. Fix navigation-interrupted waits,
Trusted Types capture, Chrome panel restrictions and deterministic tab selection.
Close ordinary launched CLI browsers even when their connection supports detach;
only explicitly kept-open sessions survive dispatcher cleanup.
Add stable viewport capture with native-view CDP, viewport-only engine fallbacks
and displayed-window regression coverage; document full-page compositor effects.
Preserve readiness timer expiry when the rounded clock still reports budget.
