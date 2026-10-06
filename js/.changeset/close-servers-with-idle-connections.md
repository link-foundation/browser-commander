---
'browser-commander': patch
---

Close the parity probe server only after it stops listening, so a connection
that arrives during shutdown can no longer keep `close()` waiting. Test fixture
servers now drop idle browser preconnections too, which stopped the Safari
smoke test from timing out during cleanup on Node 24.
