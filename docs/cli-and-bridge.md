# CLI and `serve --stdio` Bridge Contract

Issue [#104](https://github.com/link-foundation/browser-commander/issues/104)
requires one `browser-commander` CLI with identical commands in the npm package
(`bin`), the Rust crate (binary) and the Python package (console script), and a
JSON-RPC mode that lets any language or shell script drive any engine. This
document is the contract the three implementations follow; the cross-language
CLI tests (`tests/cli-contract/`) run the same command script through each CLI
and compare the results. The Python and Rust CLIs use the companion npm package
for the generic Playwright/Puppeteer/Selenium dispatcher: install it alongside the
Python package or Rust binary, or set `BROWSER_COMMANDER_JS_CLI` to its bin
script. `BROWSER_COMMANDER_NODE` selects the Node executable.

## Output conventions

- Every command writes **exactly one JSON document** to stdout, followed by a
  newline, and nothing else. Logs, progress and browser output go to stderr.
- Exit code `0` on success. On failure the command prints
  `{"error": {"name": "...", "message": "..."}}` to stdout and exits `1`.
  `doctor` exits `2` when it finds a difference that is not listed in
  `limitations.json`. Usage errors exit `64`.
- Option names are kebab-case on the command line and camelCase in JSON.

## Commands

| Command                   | Arguments and options                                                                                                                                                                  | Result                                                                                                                                                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`                 |                                                                                                                                                                                        | `{"name":"browser-commander","version":"…","language":"js\|rust\|python"}`                                                                                                                                                                                                       |
| `launch`                  | `--engine`, `--browser chrome\|edge\|brave\|chromium`, `--executable-path`, `--user-data-dir`, `--headless`, `--restriction NAME` (repeatable), `--launch real\|engine`, `--keep-open` | `{"cdpEndpoint","remoteDebuggingPort","userDataDir","temporaryProfile","args"}`. With `--keep-open`, use a dedicated `--user-data-dir` and fixed `--remote-debugging-port`; the controller detaches and exits, and the owned browser survives until `--idle-timeout-ms` expires. |
| `open <url>`              |                                                                                                                                                                                        | Opens `url` in the user's default browser with no automation (macOS `open`, Linux `xdg-open`, Windows `explorer.exe`). `{"opened": url, "command": [...]}`                                                                                                                       |
| `goto <url>`              | page options                                                                                                                                                                           | `{"url": finalUrl, "title"}`                                                                                                                                                                                                                                                     |
| `click <selector>`        | page options                                                                                                                                                                           | `{"clicked": selector}`                                                                                                                                                                                                                                                          |
| `fill <selector> <value>` | page options                                                                                                                                                                           | `{"filled": selector, "value"}`                                                                                                                                                                                                                                                  |
| `eval <expression>`       | page options                                                                                                                                                                           | `{"value": <JSON result>}`                                                                                                                                                                                                                                                       |
| `screenshot <path>`       | page options, `--full-page`                                                                                                                                                            | `{"path", "bytes"}`                                                                                                                                                                                                                                                              |
| `pdf <path>`              | page options                                                                                                                                                                           | `{"path", "bytes"}`                                                                                                                                                                                                                                                              |
| `trace start`             | `--out DIR`, page options                                                                                                                                                              | Records a portable trace until `trace stop` or SIGINT. `{"trace": DIR, "stopped": true}`                                                                                                                                                                                         |
| `trace stop`              | `--out DIR`                                                                                                                                                                            | Writes the stop marker `DIR/.stop`. `{"trace": DIR, "stopRequested": true}`                                                                                                                                                                                                      |
| `trace view <dir>`        | `--out FILE`                                                                                                                                                                           | Renders the static viewer. `{"viewer": FILE}`                                                                                                                                                                                                                                    |
| `cookies import`          | `--from BROWSER`, `--profile NAME`, `--domain D` (repeatable), page options                                                                                                            | `{"imported": n, "skipped": [...]}`                                                                                                                                                                                                                                              |
| `cookies sources`         | `--domain D` (repeatable)                                                                                                                                                              | Lists the browsers and profiles that hold cookies, with cookie counts (and per-domain counts when `--domain` is given). Names and counts only, never values. `{"sources": [{"browser","profile","path","isDefault","cookies","byDomain"}]}`                                      |
| `profile migrate`         | `--from BROWSER` (also `default`/`auto`), `--profile NAME`, `--user-data-dir DIR`, `--target-browser BROWSER`, `--to DIR`, `--include LIST` (comma separated), `--domain D`            | the migration report (see below)                                                                                                                                                                                                                                                 |
| `profile sources`         | `--browser BROWSER` (also `default`/`auto`)                                                                                                                                            | Lists the installed browser profiles (never cookie values). `{"profiles": [{"browser","name","displayName","path","isDefault"}]}`                                                                                                                                                |
| `doctor`                  | `--browser`, `--executable-path`, `--engine`, `--headless`                                                                                                                             | the `measureParity()` report (see below)                                                                                                                                                                                                                                         |
| `run <script.json>`       |                                                                                                                                                                                        | Runs a command script. `{"results": [...]}`                                                                                                                                                                                                                                      |
| `serve --stdio`           |                                                                                                                                                                                        | JSON-RPC 2.0 on stdin/stdout, one message per line                                                                                                                                                                                                                               |

`profile sources` and `cookies sources` preserve Safari discovery failures as
entries with `error`, alongside readable sources. A `Profiles` error describes
the profile catalogue; it does not replace a readable `Default` profile. Error
entries have no cookie counts and remain visible under `--domain` filtering.

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
sessions `s1`, `s2`, …), so the same script produces equivalent results in
every language after normalizing endpoints, temporary paths, and versions.
`$session` in params is replaced with the id returned by the
latest `session.launch`/`session.connect`.

Capture options and the `record start|stop`, `gif`, `trace summarize` and
`trace render` commands are documented in the [capture guide](capture-and-debugging.md#shared-cli).
The `page.screenshot` method accepts these typed capture options. `record.start`
and `record.stop` manage a bounded recorder in the supplied session.

## JSON-RPC methods (`serve --stdio`, `run`)

Messages are JSON-RPC 2.0 objects, one per line. Requests may be pipelined;
responses carry the request `id`. Notifications from the server have no `id`.

### High-level methods

These mirror the CLI commands. Python and Rust forward this protocol to the
companion JavaScript dispatcher.

| Method                       | Params                                                                                     | Result                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `session.launch`             | `engine`, `browser`, `executablePath`, `userDataDir`, `headless`, `restrictions`, `launch` | `{"session","cdpEndpoint","remoteDebuggingPort","userDataDir","temporaryProfile"}` |
| `session.connect`            | `cdpEndpoint`, `engine`                                                                    | `{"session","cdpEndpoint"}`                                                        |
| `session.close`              | `session`                                                                                  | `{"closed": true}`                                                                 |
| `page.goto`                  | `session`, `url`                                                                           | `{"url","title"}`                                                                  |
| `page.click`                 | `session`, `selector`                                                                      | `{"clicked"}`                                                                      |
| `page.fill`                  | `session`, `selector`, `value`                                                             | `{"filled","value"}`                                                               |
| `page.eval`                  | `session`, `expression`                                                                    | `{"value"}`                                                                        |
| `page.screenshot`            | `session`, `path?`, `fullPage?`                                                            | `{"path","bytes"}` or `{"data":{"$binary":…}}`                                     |
| `page.pdf`                   | `session`, `path?`                                                                         | as `page.screenshot`                                                               |
| `trace.start` / `trace.stop` | `session`, `out`                                                                           | `{"trace"}`                                                                        |
| `cookies.import`             | `session`, `from`, `profile`, `domains`                                                    | `{"imported","skipped"}`                                                           |
| `cookies.sources`            | `domains?`                                                                                 | `{"sources":[...]}` (names and counts only, never values)                          |
| `profile.migrate`            | `from`, `profile`, `userDataDir`, `targetBrowser`, `to`, `include`, `domains`              | migration report                                                                   |
| `profile.sources`            | `browser?`                                                                                 | `{"profiles":[...]}`                                                               |
| `open`                       | `url`                                                                                      | `{"opened"}`                                                                       |
| `doctor`                     | as the command                                                                             | parity report                                                                      |
| `version`                    |                                                                                            | as the command                                                                     |

### Generic handle methods (full engine API)

These expose every public method of an engine through remote object handles,
so a language without a native binding still reaches the whole API. The JS CLI
implements them directly; the Rust and Python CLIs forward them to the JS CLI
(`browser-commander serve --stdio`, started through command-stream in Rust and
the `browser_commander.utilities.subprocess` wrapper in Python).

| Method               | Params                                                           | Result                                                                                                    |
| -------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `handle.root`        | `name`: `playwright`, `puppeteer`, `selenium`, or `session:<id>` | `{"$handle","type"}`; session roots include `browser`, `context`, `page`, and Selenium's `driver` handles |
| `handle.call`        | `handle`, `method`, `args`                                       | the encoded return value (promises are awaited)                                                           |
| `handle.get`         | `handle`, `property`                                             | the encoded property value                                                                                |
| `handle.construct`   | `handle`, `args?`                                                | New engine instance, encoded as a handle                                                                  |
| `handle.dispose`     | `handle`                                                         | `{"disposed": true}`                                                                                      |
| `handle.describe`    | `handle`                                                         | `{"type","methods":[...]}`: every callable member on the object and its prototype chain                   |
| `events.subscribe`   | `handle`, `event`                                                | `{"subscription"}`; then `events.emit` notifications `{"subscription","args"}`                            |
| `events.unsubscribe` | `subscription`                                                   | `{"unsubscribed": true}`                                                                                  |

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

## Replacing the 27-operation bridge

Before this contract, the Rust crate drove Node engines through
`rust/src/browser/node_engine_bridge.js`. That script handled exactly 27
operations, used its own `{id, ok, result|error}` framing and kept a single
implicit page. `serve --stdio` replaces it. Every old operation maps onto a
high-level method or a generic handle call, so no method-specific code is
needed in the port.

In the table below, `page` is the `page` handle that
`handle.root {"name":"session:<id>"}` returns. `call(page, m, args)` stands for
`handle.call {"handle": page, "method": m, "args": args}`, and `fn(...)` is a
`{"$function": "..."}` argument.

| Old operation       | Replacement                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `launch`            | `session.launch` (`headless`, `userDataDir`, `slowMo`, `args`, `ignoreDefaultArgs`, `executablePath`, `engine`)                         |
| `connect`           | `session.connect` (`cdpEndpoint`, `engine`)                                                                                             |
| `close`             | `session.close`                                                                                                                         |
| `url`               | `call(page, "url", [])`                                                                                                                 |
| `goto`              | `page.goto`                                                                                                                             |
| `querySelector`     | `call(page, "evaluate", [fn(elementInfo), selector])`                                                                                   |
| `querySelectorAll`  | `call(page, "evaluate", [fn(all elementInfo), selector])`                                                                               |
| `count`             | `call(page, "evaluate", [fn((s) => document.querySelectorAll(s).length), selector])`                                                    |
| `click`             | `page.click`                                                                                                                            |
| `fill`              | `page.fill` (Playwright `fill`; Puppeteer `locator().fill()`)                                                                           |
| `typeText`          | `call(page, "focus", [selector])`, then `call(keyboard, "type", [text])`                                                                |
| `textContent`       | `call(page, "evaluate", [fn(...), selector])`                                                                                           |
| `inputValue`        | `call(page, "evaluate", [fn(...), selector])`; Playwright also has `call(page, "inputValue", [selector])`                               |
| `getAttribute`      | `call(page, "evaluate", [fn(...), {selector, attribute}])`; Playwright also has `call(page, "getAttribute", [selector, attribute])`     |
| `isVisible`         | `call(page, "evaluate", [fn(elementInfo), selector])`; Playwright also has `call(page, "isVisible", [selector])`                        |
| `isEnabled`         | `call(page, "evaluate", [fn(...), selector])`; Playwright also has `call(page, "isEnabled", [selector])`                                |
| `waitForSelector`   | `call(page, "waitForSelector", [selector, {state: "visible", timeout}])` (Playwright) or `{visible: true, timeout}` (Puppeteer)         |
| `scrollIntoView`    | `call(page, "evaluate", [fn(...), selector])`                                                                                           |
| `evaluate`          | `page.eval` (`expression`), or `call(page, "evaluate", [fn(...), ...args])` for a function                                              |
| `screenshot`        | `page.screenshot` without `path`, which returns `{"data":{"$binary":…}}`                                                                |
| `pdf`               | `page.pdf` without `path`; other PDF options go through `call(page, "pdf", [options])`                                                  |
| `bringToFront`      | `call(page, "bringToFront", [])`                                                                                                        |
| `waitForNavigation` | `call(page, "waitForLoadState", ["load", {timeout}])` (Playwright) or `call(page, "waitForNavigation", [{timeout, waitUntil: "load"}])` |
| `keyboardPress`     | `call(keyboard, "press", [key])`                                                                                                        |
| `keyboardType`      | `call(keyboard, "type", [text])`                                                                                                        |
| `keyboardDown`      | `call(keyboard, "down", [key])`                                                                                                         |
| `keyboardUp`        | `call(keyboard, "up", [key])`                                                                                                           |

`keyboard` is `handle.get {"handle": page, "property": "keyboard"}`. The old
bridge returned an error as a stack string. The new one returns a JSON-RPC
error, and engine errors keep the stack in `data.stack`. The old `sandbox`
launch flag becomes `args` (for example `--no-sandbox`).

Rust Playwright no longer needs this mapping when a matching driver is
installed. `launch_browser()` and `connect_browser()` then talk to
`playwright-core/cli.js run-driver` directly, through the typed protocol
bindings in `rust/src/playwright/protocol/`. The bridge is the fallback when
no matching driver is found, and it is still the path Rust Puppeteer takes.

Rust and Python also have typed Puppeteer clients for this protocol:
`browser_commander::puppeteer` in both packages. They start `serve --stdio`,
call `handle.root {"name": "puppeteer"}` and wrap every returned
`{"$handle","type"}` in the class generated for that Puppeteer type
(`CdpPage` and `BidiPage` both become `Page`). The wrappers are generated by
`scripts/generate-puppeteer-bindings.mjs` from puppeteer-core's
`lib/types.d.ts`. `js/tests/unit/puppeteer-bindings-coverage.test.js` fails
when they are stale or when any declared method or getter has no typed entry
point in either language.

## Implementation notes (JS)

These details are not required by the contract. The other CLIs should follow
them so that the outputs stay identical.

- **Run entries.** Each `run` result is `{"method", "result"}` or
  `{"method", "error"}`. `error` has the JSON-RPC shape but its `data` has no
  `stack`, because stacks differ between machines. A failed step does not
  stop the script. `run` exits `1` if any step failed.
- **CLI options in `run`.** Browser options given to `run` on the command line
  (`--engine`, `--executable-path`, `--headless`, `--arg`, …) become the
  defaults of every `session.launch` step. The step's own params win.
- **Ids.** Subscriptions are numbered `e1`, `e2`, … and handles `h1`, `h2`, ….
  `handle.root` for a session always returns handles for `browser`, `context`
  and `page`. For `playwright` and `puppeteer` it returns the module's default
  export.
- **`handle.describe`** also returns `properties`, the non-function members,
  next to `type` and `methods`.
- **`launch` without `--keep-open`** prints the document and then closes the
  browser. With `--keep-open` the browser also stops when it disconnects.
- **Values that start with `--`** must use the `=` form, for example
  `--arg=--lang=de`. Otherwise they are read as another option.

## Reports

Launch and migration targets must use dedicated profiles. On macOS, an app's
own profile under `~/Library/Application Support/<app>/` is accepted. Safari's
data directories (`~/Library/Safari`, `~/Library/Cookies` and its container),
Safari Technology Preview's data directories, and other browsers' default
profile roots and their descendants remain protected. The shared catalogue's
optional `protectionRoots` declarations control this protection; import discovery
continues to use `roots`, including broad legacy Safari search locations.

Safari sources (`safari`, `safari-technology-preview`, alias `safari-tp`) support
cookies through the same CLI and JSON-RPC methods as other sources. For example,
`profile migrate --from safari --include cookies --domain github.com --to ./profile`
or `profile.migrate` with `{"from":"safari","include":["cookies"],"domains":["github.com"],"to":"./profile"}`.
Targets remain Chromium. A custom `userDataDir` can point at a directory containing
`Cookies/Cookies.binarycookies` or directly at the cookie-store directory.
Unsupported selected Safari classes are skipped with a reason; passwords require
an explicit Safari/Passwords CSV export supplied with `--password-csv` or
the `passwordCsv` JSON-RPC parameter. Bookmarks and history are translated;
named Safari profiles and modern WebKit cookie-store paths are discovered.
See the generated [migration matrix](profile-migration.md) for target/class limits.
The format lacks SameSite, so imported cookies use `Lax` and the report includes
`safari-samesite-unavailable`. Discovery decodes only hosts and counts, never names
or values. File-level access errors are retained in `cookies.sources` entries;
EPERM/EACCES explains which application needs Full Disk Access. A scoped
default/auto import reports an unreadable default source instead of treating it
as empty and silently choosing a different browser.

Chromium password imports also re-encrypt retained password notes with the
target key and remove notes/security records whose login was excluded or could
not be decrypted. Domain filters apply to the independent origin statistics.
Copied sync metadata is reset with `sync-metadata-reset` warnings. During a
domain-filtered import, unrecognized Login Data metadata tables are cleared
with `unsupported-password-metadata` warnings naming each affected table and
its removed row count; unfiltered imports preserve those tables. Unreadable
notes have individual skipped entries, without exposing note values.

The include/report schema also recognizes `localStorage`, `indexedDB`,
`sessionStorage`, `autofill`, `paymentCards`, `searchEngines`, `siteSettings`,
`openTabs`, `downloads`, `readingList`, `clientCertificates` and `passkeys`.
Classes without a native source reader and target writer return zero counts
with `data-class-not-supported` entries. Payment cards require the separate
boolean `includePaymentCards` (`include_payment_cards` in Python/Rust,
`--include-payment-cards` in the CLI), including in pre-launch migration.
Selecting `paymentCards` alone returns `payment-card-consent-required` without
reading card stores. Consent currently still returns an unsupported report;
it does not establish a payment-card writer.

Firefox `history` imports translate each Places visit to Chromium and preserve
microsecond timestamps. `--domain` filters exact hosts and their subdomains;
bookmark-only URLs are excluded. Invalid URLs/dates have individual skipped
entries, and a warning identifies transition/referrer/sync metadata that was
not translated. A missing visit table returns `source-format-unsupported`
before writing history.

Passkey selection returns `passkey-not-exportable` entries for iCloud Keychain,
Google Password Manager and Windows Hello: browser profile copies cannot export
their private keys. Provider-authorized transfer is separate. Sign in once with
the platform passkey in a dedicated persistent profile and retain its session.
Client certificates return `client-certificates-os-export-required`, naming the
need for an authorized OS/NSS export and non-exportable/hardware key limits.

The migration report (`profile.migrate`, `launchRealBrowser({migrateFrom})`):

```json
{
  "source": { "browser": "chrome", "profile": "Default", "userDataDir": "…" },
  "target": "…",
  "migrated": {
    "cookies": 120,
    "bookmarks": 1,
    "history": 1,
    "passwords": 4,
    "preferences": 5,
    "extensions": 2,
    "localStorage": 0,
    "indexedDB": 0,
    "sessionStorage": 0,
    "autofill": 0,
    "paymentCards": 0,
    "searchEngines": 0,
    "siteSettings": 0,
    "openTabs": 0,
    "downloads": 0,
    "readingList": 0,
    "clientCertificates": 0,
    "passkeys": 0
  },
  "skipped": [
    { "type": "cookies", "item": ".google.com SIDTS", "reason": "dbsc-bound" },
    {
      "type": "localStorage",
      "item": "…",
      "reason": "data-class-not-supported"
    },
    {
      "type": "paymentCards",
      "item": "…",
      "reason": "payment-card-consent-required"
    }
  ],
  "warnings": []
}
```

With `--from default` (or `auto`) and `--domain`, a default browser that holds
no cookies for those domains is not a dead end: the migration reads the
installed profile holding the most of them instead (only names and counts are
checked first, as `cookies sources` does), names it in `source`, and adds a
warning such as:

```json
{
  "type": "source",
  "item": "librewolf",
  "reason": "default-browser-fallback",
  "detail": "The default browser (firefox) holds no cookies for github.com; imported from librewolf instead."
}
```

The reason is `default-browser-unknown` when the default browser itself could
not be determined.

The parity report (`doctor`, `measureParity()`):

```json
{
  "browser": { "executablePath": "…", "version": "…" },
  "commandLine": {
    "launched": ["…"],
    "reference": ["…"],
    "extra": [],
    "missing": []
  },
  "differences": [
    {
      "path": "navigator.webdriver",
      "expected": false,
      "actual": true,
      "limitation": null
    }
  ],
  "unlisted": [],
  "ok": true
}
```

## Selenium engine

All three language CLIs accept `--engine selenium`. JavaScript launches its
native WebDriver through the common launcher; Python and Rust opt into that
shared dispatcher when invoking CLI commands. Native library launches continue
using their language's integrations. `--driver-path` selects ChromeDriver or
GeckoDriver, `--bidi` requests WebDriver BiDi, and `--server-url` attaches to an
existing driver/Grid instead of starting one. JSON-RPC `session.connect` accepts
`engine: "selenium"`, `serverUrl`, and `capabilities`, or a Chrome `cdpEndpoint`.

`handle.root {"name":"selenium"}` exposes `selenium-webdriver`. Session roots
include `driver`, which exposes the full native API, and `page`, which exposes
the common facade. Constructors are obtained with `handle.get` and invoked with
`handle.construct {"handle": constructorHandle, "args": []}`. `page.fill` clears
and fills a native WebElement. See [engine support](engine-support.md) for
browser and protocol limitations.
