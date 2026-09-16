---
'browser-commander': minor
---

Record traces continuously across navigation and live state, and export them as
Links Notation.

`startTrace({mode: 'continuous'})` now keeps recording when the page navigates,
changes route or creates a frame: the observers are reinstalled from an init
script that runs before the page's own code, so nothing that happens during a
load is lost. What a person changes but the DOM does not show - typing,
checking, selecting, focus and scroll - is recorded as semantic live-state
records and applied on replay, child-list records carry the position a node was
inserted at or removed from, and every record carries stable trace, browser
context, page, navigation, frame and action identities. `initialCheckpoint` (on
by default) captures the page before the first action so the first interval has
a base to replay onto, and the viewer says what it is: a diagnostic replay of
what was recorded, not a re-execution of the session.

`writeTraceLinks(trace, './run.lino', {include})` writes a portable Links
Notation view of a bundle, and `startTrace({links: {output}})` writes the same
view incrementally as the run happens. One link per line: one per ordered
timeline event with its sequence, time, kind, owner ids, actor, action, target
and outcome; one per checkpoint naming its HTML, state and screenshot members by
their path inside the bundle; one per control that changed between two
checkpoints. Dropped and partial records are explicit, binary content is never
duplicated, and redaction is whatever the bundle already decided. The JSON
bundle stays authoritative - this is an adapter, not a replacement.

A managed download whose CDP completion arrives before the file does is no
longer reported as a missing file: the staged bytes are waited for, and a
timeout or a genuinely missing file is still a failure rather than a path that
does not exist.
