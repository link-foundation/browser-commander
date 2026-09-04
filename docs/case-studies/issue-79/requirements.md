# Issue 79 Requirements

Every sentence of
[issue 79](https://github.com/link-foundation/browser-commander/issues/79) is
broken out below, with what it takes to satisfy it, what has been done, and
what is left. Status values are:

- **done** -- implemented and verified in this pull request.
- **partial** -- implemented for some languages or some surfaces; the gap is named.
- **planned** -- designed, not yet implemented; the plan is stated.

Measurements referenced here are in [`measurements.md`](./measurements.md);
comparable work in other projects is in [`prior-art.md`](./prior-art.md).

---

## R1. Zero difference from a real browser, in any configuration

> "For all browsers there should be tests that prove exactly 0 difference in
> any configuration between real browser and browser controlled by our library."

**What it takes.** A definition of "difference" that is not a matter of
opinion, a baseline that is genuinely a real browser, and a test that fails
when the gap reopens.

**Solution.** Three pieces, in order:

1. *A probe.* `experiments/fingerprint-parity/probe.js` produces one
   deterministic JSON report of everything a page can read: 30 sections
   covering `navigator`, client hints, property descriptors, plugins, screen,
   window geometry, `Intl`, media queries, CSS, fonts, canvas, WebGL, audio,
   codecs, permissions, media devices, connection, battery, speech, error
   stacks, native-function source, iframes, WebGPU, storage, workers and CDP
   side effects.
2. *A baseline that is not automated.* The reference capture starts Chrome as a
   plain child process and receives the report over HTTP. It never speaks CDP.
   Every automated capture is delivered the same way, so a diff entry is a
   difference in the browser rather than in how the probe was invoked.
3. *A diff, run as a test.* `js/tests/e2e/fingerprint-parity.e2e.test.js`
   asserts the diff is empty.

**Status: done for Chrome/Chromium via Playwright and Puppeteer, in both
headful and headless mode.**

| Configuration | Result |
| --- | --- |
| headful, Playwright, `launchBrowser` | 0 differences |
| headful, Puppeteer, `launchBrowser` | 0 differences |
| headless, Playwright, `launchBrowser` | 0 differences |
| headless, Puppeteer, `launchBrowser` | 0 differences |

Two negative controls keep the assertion honest. `automationParity: false`
must produce a `navigator.webdriver` difference -- if it does not, the probe
has stopped measuring and the empty diffs mean nothing. And `referenceSecond`,
a second hand-started Chrome diffed against the first, must be empty -- if it
is not, the probe is not deterministic.

Headless is compared against a *headless* reference, not a headful one. A real
headless Chrome differs from a real headful Chrome in thirteen probe fields with
no automation involved: `HeadlessChrome` in the user agent and `appVersion` --
in the document, in an iframe and in a worker -- an 800x600 screen with
`availWidth` and `availHeight` following it, the four hover and pointer media
queries, and a SwiftShader WebGL renderer. Comparing headless output against a headful baseline would
report those as failures of the library, which they are not.

**What is not covered, and the plan.**

- *Firefox and WebKit.* The repository drives Chrome and Chromium only, and the
  mechanism this fix rests on -- the `AutomationControlled` Blink runtime
  feature -- is Chromium-specific. Firefox is not a matter of finding the right
  switch: the `dom.webdriver.enabled` preference that once controlled the
  property was
  [removed on purpose](https://bugzilla.mozilla.org/show_bug.cgi?id=1632821),
  and `navigator.webdriver` is now derived from `nsIMarionette::running`, so it
  reports whether an automation session is genuinely active. There is no
  supported way to turn that off from outside the browser, which makes it a
  different kind of problem from the Chromium one, and possibly an unsolvable
  one without a patched build. Plan: add `probe.js` captures for `firefox` and
  `webkit` behind the same harness and land the measurement first -- how close
  Firefox can get is not knowable from documentation alone, and the harness is
  the thing that can answer it.
- *"Any configuration" is unbounded.* The suite covers the configurations the
  library actually offers: two engines x headless/headful x parity on/off x
  with and without a fingerprint profile. A caller who passes arbitrary Chrome
  switches can still break parity; `detectAutomationControlledTriggers` is
  exported so that such a caller can be told which switch did it.
- *CI.* The suite is opt-in (`RUN_E2E=true`) because it needs a real Chrome and
  a display. Plan: a scheduled workflow that runs it under Xvfb, so a Chrome
  update that reopens a gap is noticed without waiting for someone to re-run an
  experiment by hand.

---

## R2. Everything about the user environment must be configurable

> "All data about user environment should be fully configurable: any number of
> cores, any hardware, any OS, user agent, any locale and so on. Exactly
> everything that can be configured."

**What it takes.** A profile type covering the whole surface, validation that
rejects impossible combinations, and -- the part that is easy to skip -- an
honest record of *how* each field is enforced, because a field the browser
enforces and a field patched in JavaScript are not equally convincing.

**Solution.** `js/src/fingerprint/profile.js` normalises and validates a
profile; `FINGERPRINT_FIELD_MECHANISMS` records the mechanism per field.

Enforced by the browser through CDP `Emulation` -- consistent everywhere,
including HTTP headers and workers that inherit them:

`userAgent`, `userAgentData`, `acceptLanguage`, `languages`, `locale`,
`timezoneId`, `hardwareConcurrency`, `platform`, `screen`, `viewport`,
`maxTouchPoints`, `geolocation`, `colorScheme`, `reducedMotion`,
`forcedColors`.

Patched in JavaScript, because CDP has no command for them:

`vendor`, `deviceMemory`, `doNotTrack`, `webgl`.

**Status: done for the surfaces that can be configured; the boundary is
documented rather than blurred.**

The specific asks in the issue map onto:

| Issue wording | Field | Mechanism |
| --- | --- | --- |
| any number of cores | `hardwareConcurrency` | browser |
| any hardware | `deviceMemory`, `webgl`, `screen`, `maxTouchPoints` | mixed |
| any OS | `platform`, `userAgentData.platform`/`platformVersion`, `userAgent` | browser |
| user agent | `userAgent`, `userAgentData` | browser |
| any locale | `locale`, `languages`, `acceptLanguage`, `timezoneId` | browser |

Four presets -- `windows-chrome`, `macos-chrome`, `linux-chrome`,
`android-chrome` -- produce internally consistent profiles, so a caller does
not have to know that claiming `MacIntel` while sending a Windows
`Sec-CH-UA-Platform` is worse than claiming nothing.

Validation exists to stop self-contradictory profiles. It rejects q-values in
`acceptLanguage` (measurement 5: Chrome builds the ladder itself, and passing
one double-encodes the header and pollutes `navigator.languages`), a viewport
larger than the screen, and unknown fields.

**What is not covered, and the plan.**

- *Canvas, audio and font metrics.* Deliberately not configurable. The usual
  countermeasure is per-session noise, which is itself a giveaway: a real
  browser returns the same digest twice in a row and a noised one does not. The
  documented answer is to match the host environment -- a container image with
  the font set you intend to claim -- rather than to lie badly.
- *WebGL numeric limits.* The vendor and renderer strings can be replaced;
  `MAX_TEXTURE_SIZE`, `ALIASED_LINE_WIDTH_RANGE`, bit depths and the extension
  list come from the real driver. Claiming an Apple GPU while reporting Mesa's
  limits is more identifying than claiming nothing.
- *TLS and HTTP/2 fingerprints.* Not a JavaScript surface at all, and identical
  between a real and an automated Chrome of the same build -- so not an
  automation signal, but a constraint on how far a profile can travel from the
  browser actually running.
- *Workers.* Measurement 6: the fields patched in JavaScript do not reach a
  worker, and neither engine exposes the worker session handle needed to fix
  it. Plan: raise it upstream with both engines; in the meantime
  `buildCdpEmulationCommands` is exported so a caller on a raw CDP connection
  can replay the commands on each attached worker.

---

## R3. Heavy unit testing, and local experiments with real browsers

> "It should be heavily unit tested. You are encouraged to make experiments
> locally with real browsers."

**Status: done for JavaScript.**

The suite went from 526 to 641 tests. The fingerprint subsystem has eight unit
files (1,719 lines of tests against 1,796 lines of source) plus the e2e suite.

Two choices are worth recording because they change what the tests are worth:

*The init-script tests execute the script.* A test that asserts the generated
source contains a substring passes whether or not the script works. These build
a stand-in realm with `node:vm` -- `Navigator`, `WorkerNavigator`, `Screen`,
`WebGLRenderingContext` with deliberately wrong host values -- run the real
script in it, and then check the things that actually matter: that
`navigator.languages` returns a frozen fresh copy each time
(`navigator.languages !== navigator.languages`), that the descriptor is an
accessor with `enumerable: true`, `configurable: true`, no setter and a getter
named `get deviceMemory`, that `Function.prototype.toString` reports
`[native code]` for patched accessors *and* still reports real source for
untouched functions, and that running the script twice does not stack getters.

*The apply tests use recording doubles rather than a browser.* A fake CDP
session records `{method, params}`, so the tests can assert the ordering
constraint that matters -- every `Emulation.*` command before `Page.enable`,
because an override applied after the first document has already lost -- and
that both engines' four different session-opening paths are handled.

Eleven experiment scripts under `experiments/fingerprint-parity/` drive real
Chrome; their output is the `analysis-artifacts/` directory, and every claim in
[`measurements.md`](./measurements.md) cites one.

**What is left.** Unit tests for the Python and Rust ports, once those exist
(R5).

---

## R4. Read the browser source, and state the limitations

> "It is a must to use browser source code (if it is available) and
> documentation for browsers to clearly state limitations of what is not
> possible to configure but may affect user privacy."

**Status: done.**

The central finding came from `content/child/runtime_features.cc`, which maps
switches onto Blink runtime features in `SetRuntimeFeaturesFromCommandLine`:

```
{wrf::EnableAutomationControlled, switches::kEnableAutomation,     true},
{wrf::EnableAutomationControlled, switches::kHeadless,             true},
{wrf::EnableAutomationControlled, switches::kRemoteDebuggingPipe,  true},
```

plus a special case for `--remote-debugging-port=0`. That table is the whole
explanation for `navigator.webdriver`, and reading it is what turned a guess
("remove `--enable-automation`") into a fix that works -- measurement 1 shows
removing that switch changes nothing, and measurement 2 confirms the table
switch by switch.

The Playwright pointer switch was found the same way, in
`packages/playwright-core/src/server/chromium/chromium.ts`, and the fact that
it is appended *after* the caller's arguments is why it needs
`ignoreDefaultArgs` rather than an argument.

`js/src/fingerprint/limitations.js` is the deliverable: eleven entries, each
with a stable id, the observable surface, a severity, whether the evidence is
`measured` in this repository or `documented` upstream, what happens, what a
caller can do about it, and a reference to the artifact or source file. Seven
are marked `measured`. `relevantFingerprintLimitations(profile, options)`
filters to the ones that apply to a given profile, because a list nobody reads
protects nobody.

Severity is about privacy, as the issue asks: `high` means the entry on its own
identifies the automation or the physical machine; `medium` means it is a
strong signal in combination; `low` means it narrows the field.

---

## R5. All supported programming languages

> "This should affect all supported programming languages."

**Status: partial -- automation parity, the profile vocabulary, the CDP
commands and the init script now exist in all three languages; `apply` is still
JavaScript only.**

The subsystem is deliberately shaped for porting: pure data and pure functions,
with I/O confined to `apply.js`. `buildCdpEmulationCommands(profile)` returns
an array of `{method, params}` and touches nothing; `buildFingerprintInitScript`
returns a string. Neither needs a browser to test.

**Solution, step 1 -- done.** Automation parity now exists in all three
languages, because it is the part that closes the measured gap and it needs no
CDP at all:

- `js/src/fingerprint/automation-parity.js`
- `python/src/browser_commander/fingerprint/automation_parity.py`
- `rust/src/fingerprint/automation_parity.rs`

Each carries the same `runtime_features.cc` trigger table, the same
`--disable-blink-features` merge rule -- Chrome keeps only the last occurrence
of that switch, so the feature is appended to an existing list rather than
added as a second one -- and the same engine exclusion table. The JavaScript
unit tests were translated one for one, so a divergence in behaviour fails a
test rather than surfacing as a fingerprint difference months later.

Each language wires it into its own launcher, on by default and switchable off
for the negative controls: `automationParity` on `launchBrowser`,
`LaunchOptions.automation_parity` in Python, `LaunchOptions::automation_parity`
in Rust. Python additionally translates the exclusion list into ChromeDriver's
`excludeSwitches` form, which matches bare switch names, and the Rust Node
bridge now forwards the merged list verbatim instead of adding
`--enable-automation` itself, so turning parity off really turns it off.

**Solution, step 2 -- done.** The profile vocabulary is now the same in all
three languages:

- `python/src/browser_commander/fingerprint/{profile,derive,presets}.py`
- `rust/src/fingerprint/{profile,derive,presets}.rs`

`resolve_fingerprint_profile` validates and normalizes the same 19 fields,
rejects the same impossible values -- an available screen area larger than the
screen, a `q`-value inside `acceptLanguage`, a zero core count -- and derives
the same `acceptLanguage` and `uaFullVersion`. The four presets describe the
same four machines, and `FINGERPRINT_FIELD_MECHANISMS` records the same
`browser`/`script` split, asserted field by field in each language so the three
tables cannot drift apart silently.

Each language expresses the profile in its own idiom while keeping the
protocol's camelCase names, so a resolved profile goes to CDP without a second
vocabulary: JavaScript returns a frozen object, Python a plain `dict` (not a
`MappingProxyType`, which `json.dumps` cannot serialize), and Rust a serde
struct with `deny_unknown_fields`, which moves the unknown-field rejection from
a hand-written key set into the deserializer. Where Rust's types already
enforce what JavaScript checks at run time -- a non-integer core count cannot be
constructed -- the translated test asserts the type-level rejection instead of
being dropped.

**Solution, step 3 -- done.** The overrides themselves are now the same in
all three languages:

- `python/src/browser_commander/fingerprint/{cdp_overrides,init_script}.py`
- `rust/src/fingerprint/{cdp_overrides,init_script}.rs`

`build_cdp_emulation_commands` produces the same eight `Emulation` commands in
the same order, with the same protocol quirks encoded: the required empty
`userAgent` when only `acceptLanguage` changes, the deprecated `fullVersion`
metadata field that is the only way to reach the `uaFullVersion` hint,
`maxTouchPoints` staying at least `1` so "no touch" travels as
`enabled: false`, and the zeroes that mean "no override" in
`setDeviceMetricsOverride`. Every JavaScript test was translated, including the
one that pins the whole command list for a preset.

The init script is a shared asset rather than a translation, which the plan
called for and which turned out to matter more than expected: the payload masks
its own `Function.prototype.toString`, preserves descriptor shapes and hides its
idempotence marker, and three hand-written copies of that would drift within a
release. `js/src/fingerprint/init-payload.js` is the original; Python ships it
as package data and reads it with `Path.read_text`, Rust embeds it with
`include_str!`, and `scripts/check-shared-init-payload.sh` -- a job in
`quality.yml` -- fails the build if the copies differ by a byte. (Copies are
unavoidable: npm, PyPI and crates.io each package a single directory.) The
payload is wrapped in an IIFE before it is sent, so the page never gains a
`fingerprintPayload` global, which would be a louder signal than anything the
payload hides. The Python test suite proves the point end to end by running the
script *Python* generates through Node and reading back the patched values.

Plan for the rest:

4. **Apply.** The only part that differs per language, because each
   implementation opens a CDP session its own way.

The reason for insisting on shared assets rather than translations is in
[`prior-art.md`](./prior-art.md): `selenium-stealth` and `playwright_stealth`
are hand-made copies of the puppeteer-extra evasion list, and both rotted
because a copy has no way to notice that its original moved.

---

## R6. Dependencies at their latest versions

> "All dependencies should be updated to latest versions."

**Status: planned.**

The parity work must land first: an engine upgrade can change the default
switches this fix depends on, and until the parity suite exists there is no way
to tell whether an upgrade broke anything. With the suite in place the upgrade
is checkable rather than hopeful.

Plan: update `js/package.json`, `python/pyproject.toml` and `rust/Cargo.toml`
to current versions, run the full suite plus the parity e2e run on the new
engines, and record any behaviour change in `analysis-artifacts/`.

---

## R7. A case study in `docs/case-studies/issue-79`

> "All data should be collected and compiled into ./docs/case-studies/issue-79
> and used for deep case study analysis ... list each and every requirement
> from this issue and propose possible solutions and solutions plans for each
> requirement ... research known existing components and libraries that solve
> similar problems."

**Status: done.**

- [`README.md`](./README.md) -- scope, timeline, findings, what changed.
- This file -- every requirement, its solution and its plan.
- [`measurements.md`](./measurements.md) -- every number, with the script that
  produced it.
- [`prior-art.md`](./prior-art.md) -- nine comparable projects, what each does,
  and what was taken or rejected.
- `analysis-artifacts/` -- the raw JSON.

---

## R8. One pull request, planned and executed

> "Everything should be planned and executed in this pull request."

**Status: in progress.** The work is landing as atomic commits on
`issue-79-694d5f8686e2`, in the order above: experiments, then the subsystem,
then the wiring, then the tests, then this case study, then the ports and the
dependency updates.
