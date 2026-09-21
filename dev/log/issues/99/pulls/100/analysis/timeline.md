# Timeline and sequence of events

All times are UTC and come from the archived GitHub run metadata and logs.

## 2026-09-06: the first Python 0.5.3 release attempt

Run `34017112193` detected Python 0.5.3, built valid wheel and source
artifacts, and collected 13 fragments into `CHANGELOG.md` (log lines
3286-3304). Its first push lost a normal concurrent-writer race, rebased, and
succeeded on attempt 2 (line 3333). That warning described a recovered event,
not the release failure.

`actions/download-artifact@v7` then downloaded the package but emitted Node
`DEP0005` (`Buffer()` deprecation, lines 3355-3362). PyPI finally rejected the
OIDC exchange with `invalid-publisher` (lines 3546-3604). The changelog commit
was already on `main`, but the publish and tag creation never happened.

## 2026-09-16: the failed release becomes self-perpetuating

Because `python-v0.5.3` did not exist, the release gate correctly continued to
identify 0.5.3 as unpublished. Three later runs reached Scriv with the old
version and progressively newer fragments:

- `35051926706` at 03:28: fragment `90.added.md`;
- `35069740843` at 07:40: fragments 90 and 95;
- `35126461304` at 17:09: fragments 90, 95, and 97.

Each failed with `Entry '0.5.3 — 2026-09-06' already uses version '0.5.3'`
(latest log line 3438). Thus the PyPI configuration failure exposed a second,
independent bug: a publish retry was not idempotent once changelog collection
had already succeeded.

## 2026-09-16: the issue's six-run snapshot

All six runs used commit `a15837d6`:

- JS `35126461170` failed only on macOS: the staged file returned as one byte
  before a paused writer appended the second byte (lines 3343-3358).
- Python `35126461304` failed at the repeated Scriv collection described above.
- Documentation `35126461242` succeeded despite three broken rustdoc links
  (lines 841-865).
- Security `35126461302` succeeded despite three manifest-less archival Rust
  files and two real test macro expansion warnings (lines 8338-8342).
- Repository Quality `35126461287` succeeded despite the deprecated
  `prebuild-install` package (line 303).
- Broken Links `35126461309` succeeded with zero errors; its summary notice was
  informational (lines 276 and 286).

The JS matrix also emitted garbage-collected `FileHandle` warnings on macOS,
Windows, and Linux (lines 3202-3219, 5272-5289, and 7212-7229). The Python lint
job printed an unused-mypy-config note at line 774.

## 2026-09-21: issue 99 and PR 100

Issue 99 was opened at 08:58:23. PR 100 followed with a bootstrap commit. The
investigation archived all GitHub state, cloned the three current templates,
reproduced both failures, and traced the open descriptors to four precise test
allocations. The implementation and local full-suite verification were then
prepared on `issue-99-700c278c07b6`.
