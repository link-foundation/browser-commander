---
'browser-commander': minor
---

Add the `browser-commander` command line and its `serve --stdio` JSON-RPC
bridge (#104).

The package now installs a `browser-commander` binary. Its commands are
`version`, `launch [--keep-open]`, `open`, `goto`, `click`, `fill`, `eval`,
`screenshot`, `pdf`, `trace start|stop|view`, `cookies import`,
`profile migrate`, `doctor`, `run <script.json>` and `serve --stdio`. Each
command prints exactly one JSON document to stdout. It exits `0` on success,
`1` on error, `2` when `doctor` finds an unlisted difference, and `64` on a
usage error. Page commands either attach to a browser with `--cdp-endpoint` or
launch a temporary one. The Rust and Python CLIs follow the same contract,
`docs/cli-and-bridge.md`.

`run` and `serve --stdio` share one dispatcher. It has the high-level methods
(`session.launch`, `page.goto`, …) and generic handle methods
(`handle.root`, `handle.call`, `handle.get`, `handle.describe`,
`handle.dispose`, `events.subscribe`/`unsubscribe`). The handle methods reach
every public Playwright and Puppeteer method, and an e2e suite checks this
against the engines' shipped `.d.ts` files. Values that are not JSON are
tagged (`$handle`, `$binary`, `$function`, `$date`, …), and handle ids are
deterministic, so `tests/cli-contract/basic.json` gives byte-identical results
in every language. The bridge replaces the 27-operation
`node_engine_bridge.js` used by the Rust crate.

`createCdpSession(page)` and `commander.createCdpSession()` return one raw CDP
surface (`send`, `on`, `once`, `off`, `detach`) for Playwright and Puppeteer
pages. The cookie credential tools now run through `command-stream`, like the
browser launch.
