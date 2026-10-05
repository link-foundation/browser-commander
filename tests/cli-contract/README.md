# CLI contract

These files check that the `browser-commander` CLIs in every language behave
the same way (issue #104). The contract itself is
[docs/cli-and-bridge.md](../../docs/cli-and-bridge.md).

| File                  | What it is                                                          |
| --------------------- | ------------------------------------------------------------------- |
| `basic.json`          | A `run` script: version, launch, goto, fill, click, eval and close. |
| `basic.expected.json` | The normalized output every CLI must produce for `basic.json`.      |
| `normalize.mjs`       | Replaces the values that differ between machines and runs.          |

## Running it

```sh
browser-commander run tests/cli-contract/basic.json --headless \
  | node tests/cli-contract/normalize.mjs \
  | diff - tests/cli-contract/basic.expected.json
```

An empty diff means the CLI keeps the contract. The same command works for
the JavaScript, Rust and Python CLIs, and each one must match
`basic.expected.json` byte for byte. Browser options given on the command
line (`--engine`, `--executable-path`, `--arg=VALUE`) become the defaults of
the script's `session.launch` step.

## What normalize.mjs changes

- `cdpEndpoint`, `remoteDebuggingPort`, `userDataDir`, `executablePath`,
  `path`, `args` and `stack` become `"<volatile>"`, wherever they appear.
- A `version` result keeps only its `name`.

Everything else, including the handle and session ids (`s1`, `h1`, ...),
is deterministic and must match exactly.

`normalize.mjs` reads from a file given as its first argument, or from
standard input. It also exports `normalizeRunOutput(document)` for tests.

## Where it runs

`node tests/cli-contract/check.mjs` runs the script against real Chrome for
all nine JavaScript/Python/Rust and Playwright/Puppeteer/Selenium combinations.
It also checks generic engine handles, native Selenium drivers, and engine
constructors. Set `CHROME_PATH` and `BROWSER_COMMANDER_PYTHON` when needed;
`BROWSER_COMMANDER_LANGUAGES=javascript,python` selects a subset for local checks.
CI runs the complete matrix in the `cli` job of `.github/workflows/parity.yml`.
