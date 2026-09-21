# Fresh pull-request validation

The first post-implementation workflow set ran against exact head
`6afb1b43f5049d6bac1af4e63cb2cbb52b61f562` on 2026-09-21 UTC. Five workflows
succeeded, while three jobs exposed integration and cross-platform test errors
that local Linux checks did not model.

## JavaScript changeset check

Run `35585645557` found the new fragment in the repository diff as
`.changeset/quiet-staged-downloads.md`, then attempted to read the same basename
from the JavaScript job's `.changeset` directory. The validator is deliberately
executed from `js/` and defines the canonical repository path as
`js/.changeset`. The fragment belonged there; moving it fixes release discovery
without weakening validation.

## Workflow policy

Run `35585645801` reported that every pinned `dtolnay/rust-toolchain` use had a
stale `# master` ref comment. The pinned commit was from 2026-09-03, while the
moving `master` ref had advanced to `02cb101ec7c40f2c49e1d9714d64511d8e1b74de`,
also published by the action as stable tag `v1`. Pinning that immutable commit
with the matching `# v1` comment restores zizmor's ref-confusion guarantee.

## Python on Windows

Run `35585645620` passed on Linux and macOS but failed one new release-retry
test on Windows. The fixture wrote an em dash with `Path.write_text()` and no
encoding, so Windows used cp1252 byte `0x97`; production then correctly opened
the changelog as UTF-8 and rejected that byte. All text fixtures in the test
now specify UTF-8 explicitly, matching the repository and production contract.

The complete logs and run metadata are preserved in `ci-logs/final/`.
