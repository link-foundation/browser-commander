# CLI and `serve --stdio` Bridge Contract

Issue [#104](https://github.com/link-foundation/browser-commander/issues/104)
requires one `browser-commander` CLI with identical commands in the npm package
(`bin`), the Rust crate (binary) and the Python package (console script), and a
JSON-RPC mode that lets any language or shell script drive any engine. This
document is the contract the three implementations follow; the cross-language
CLI tests (`tests/cli-contract/`) run the same command script through each CLI
and compare the results.

## Output conventions

- Every command writes **exactly one JSON document** to stdout, followed by a
  newline, and nothing else. Logs, progress and browser output go to stderr.
- Exit code `0` on success. On failure the command prints
  `{"error": {"name": "...", "message": "..."}}` to stdout and exits `1`.
  `doctor` exits `2` when it finds a difference that is not listed in
  `limitations.json`. Usage errors exit `64`.
- Option names are kebab-case on the command line and camelCase in JSON.

## Commands

| Command | Arguments and options | Result |
| --- | --- | --- |
| `version` | | `{"name":"browser-commander","version":"…","language":"js\|rust\|python"}` |
| `launch` | `--engine`, `--browser chrome\|edge\|brave\|chromium`, `--executable-path`, `--user-data-dir`, `--headless`, `--restriction NAME` (repeatable), `--launch real\|engine`, `--keep-open` | `{"cdpEndpoint","remoteDebuggingPort","userDataDir","temporaryProfile","args"}`. With `--keep-open` the document is printed once the browser is ready and the process stays up until SIGINT/SIGTERM or stdin closes, then closes the browser. |
| `open <url>` | | Opens `url` in the user's default browser with no automation (macOS `open`, Linux `xdg-open`, Windows `cmd /c start ""`). `{"opened": url, "command": [...]}` |
| `goto <url>` | page options | `{"url": finalUrl, "title"}` |
| `click <selector>` | page options | `{"clicked": selector}` |
| `fill <selector> <value>` | page options | `{"filled": selector, "value"}` |
| `eval <expression>` | page options | `{"value": <JSON result>}` |
| `screenshot <path>` | page options, `--full-page` | `{"path", "bytes"}` |
| `pdf <path>` | page options | `{"path", "bytes"}` |
| `trace start` | `--out DIR`, page options | Records a portable trace until `trace stop` or SIGINT. `{"trace": DIR, "stopped": true}` |
| `trace stop` | `--out DIR` | Writes the stop marker `DIR/.stop`. `{"trace": DIR, "stopRequested": true}` |
| `trace view <dir>` | `--out FILE` | Renders the static viewer. `{"viewer": FILE}` |
| `cookies import` | `--from BROWSER`, `--profile NAME`, `--domain D` (repeatable), page options | `{"imported": n, "skipped": [...]}` |
| `profile migrate` | `--from BROWSER`, `--profile NAME`, `--to DIR`, `--include LIST` (comma separated), `--domain D` | the migration report (see below) |
| `doctor` | `--browser`, `--executable-path`, `--engine`, `--headless` | the `measureParity()` report (see below) |
| `run <script.json>` | | Runs a command script. `{"results": [...]}` |
| `serve --stdio` | | JSON-RPC 2.0 on stdin/stdout, one message per line |

**Page options**, accepted by every page command:

- `--cdp-endpoint URL`: attach to a browser started by `launch --keep-open` (or
  any browser with a fixed `--remote-debugging-port`). The command uses the
  first open page and leaves the browser running.
- Without `--cdp-endpoint` the command launches a temporary browser (the
  default real launch), runs, and closes it.
- `--url URL`: navigate there first (page commands other than `goto`).
- `--engine playwright|puppeteer` (JS and bridged languages), `--headless`.

## Command scripts

A command script is a JSON document `{"steps": [{"method": …, "params": …}]}`
using the JSON-RPC method names below. `run` executes the steps in order inside
one process and prints `{"results": [...]}` with each step's `result` (or
`error`). Handle ids are deterministic (`h1`, `h2`, … in allocation order;
sessions `s1`, `s2`, …), so the same script produces byte-identical results in
every language. `$session` in params is replaced with the id returned by the
latest `session.launch`/`session.connect`.

## JSON-RPC methods (`serve --stdio`, `run`)

Messages are JSON-RPC 2.0 objects, one per line. Requests may be pipelined;
responses carry the request `id`. Notifications from the server have no `id`.

### High-level methods

These mirror the CLI commands and are implemented natively in every language.

| Method | Params | Result |
| --- | --- | --- |
| `session.launch` | `engine`, `browser`, `executablePath`, `userDataDir`, `headless`, `restrictions`, `launch` | `{"session","cdpEndpoint","remoteDebuggingPort","userDataDir","temporaryProfile"}` |
| `session.connect` | `cdpEndpoint`, `engine` | `{"session","cdpEndpoint"}` |
| `session.close` | `session` | `{"closed": true}` |
| `page.goto` | `session`, `url` | `{"url","title"}` |
| `page.click` | `session`, `selector` | `{"clicked"}` |
| `page.fill` | `session`, `selector`, `value` | `{"filled","value"}` |
| `page.eval` | `session`, `expression` | `{"value"}` |
| `page.screenshot` | `session`, `path?`, `fullPage?` | `{"path","bytes"}` or `{"data":{"$binary":…}}` |
| `page.pdf` | `session`, `path?` | as `page.screenshot` |
| `trace.start` / `trace.stop` | `session`, `out` | `{"trace"}` |
| `cookies.import` | `session`, `from`, `profile`, `domains` | `{"imported","skipped"}` |
| `profile.migrate` | `from`, `profile`, `to`, `include`, `domains` | migration report |
| `open` | `url` | `{"opened"}` |
| `doctor` | as the command | parity report |
| `version` | | as the command |

### Generic handle methods (full engine API)

These expose every public method of an engine through remote object handles,
so a language without a native binding still reaches the whole API. The JS CLI
implements them directly; the Rust and Python CLIs forward them to the JS CLI
(`browser-commander serve --stdio`, started through command-stream in Rust and
the `browser_commander.utilities.subprocess` wrapper in Python).

| Method | Params | Result |
| --- | --- | --- |
| `handle.root` | `name`: `playwright`, `puppeteer`, or `session:<id>` | `{"$handle","type"}`; for a session, `{"browser","context","page"}` handles |
| `handle.call` | `handle`, `method`, `args` | the encoded return value (promises are awaited) |
| `handle.get` | `handle`, `property` | the encoded property value |
| `handle.dispose` | `handle` | `{"disposed": true}` |
| `handle.describe` | `handle` | `{"type","methods":[...]}`: every callable member on the object and its prototype chain |
| `events.subscribe` | `handle`, `event` | `{"subscription"}`; then `events.emit` notifications `{"subscription","args"}` |
| `events.unsubscribe` | `subscription` | `{"unsubscribed": true}` |

**Value encoding.** JSON values pass through unchanged. Everything else is
tagged:

- `{"$handle": "h3", "type": "Page"}`: a remote object (any non-plain object,
  class instance or function). Pass it back as an argument in the same form.
- `{"$binary": "<base64>"}`: a `Buffer`/`Uint8Array` in either direction.
- `{"$function": "(el) => el.textContent"}`: a function source, compiled on
  the server (used for `evaluate`, `waitForFunction`, `route` handlers, …).
- `{"$undefined": true}`, `{"$date": "<ISO>"}`, `{"$regexp": {"source","flags"}}`,
  `{"$bigint": "123"}`, `{"$error": {"name","message"}}`.
- Plain objects and arrays are encoded recursively.

**Errors.** JSON-RPC error codes: `-32700` parse error, `-32600` invalid
request, `-32601` unknown method, `-32602` invalid params, `-32000` engine
error with `data: {"name","message","stack"}`.

## Reports

The migration report (`profile.migrate`, `launchRealBrowser({migrateFrom})`):

```json
{
  "source": {"browser": "chrome", "profile": "Default", "userDataDir": "…"},
  "target": "…",
  "migrated": {"cookies": 120, "bookmarks": 1, "history": 1, "passwords": 4, "preferences": 5, "extensions": 2},
  "skipped": [{"type": "cookies", "item": ".google.com SIDTS", "reason": "dbsc-bound"}],
  "warnings": []
}
```

The parity report (`doctor`, `measureParity()`):

```json
{
  "browser": {"executablePath": "…", "version": "…"},
  "commandLine": {"launched": ["…"], "reference": ["…"], "extra": [], "missing": []},
  "differences": [{"path": "navigator.webdriver", "expected": false, "actual": true, "limitation": null}],
  "unlisted": [],
  "ok": true
}
```
