---
'browser-commander': patch
---

Use Command Stream 3 and Links Notation 0.31 so applications can share their
installed copies with Browser Commander. Existing trace exports remain
compatible. For Command Stream terminal capture, install `@xterm/headless`
and a working `node-pty` addon. Add `@resvg/resvg-js` and `gifenc` for
terminal GIFs.
