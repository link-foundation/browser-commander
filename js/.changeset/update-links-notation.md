---
'browser-commander': patch
---

Upgrade Links Notation to ^0.25.2 so consumers using 0.25.2 can share one copy without an override. Preserve trace text containing lone UTF-16 surrogates, verify export/import and streaming compatibility, and document the new empty/control-value literals for consumers upgrading older parsers.
