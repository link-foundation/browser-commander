---
'browser-commander': minor
---

Leave JavaScript launch and commander recording off by default for read-only-safe navigation. Opt in with debug:true, a debug object or BROWSER_COMMANDER_DEBUG=1. Add bounded managed recording directories, retention controls and stopDebug(), with cleanup limited to the session's owned child directory. Document migration from 0.30.x and application-owned signal teardown.
