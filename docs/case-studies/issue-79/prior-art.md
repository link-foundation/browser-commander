# Issue 79 Prior Art

Issue 79 asks for a survey of "known existing components and libraries that
solve similar problems". This is that survey: what each project does, what it
gets right, what it costs, and what was taken or rejected here.

A note on sources. Several of these projects are marketed alongside services
that sell bot traffic, and their benchmark claims are self-reported. Where a
claim was testable it was tested and the result is in
[`measurements.md`](./measurements.md); where it was not, it is reported as a
claim rather than a fact.

## The two philosophies

Everything below sits somewhere on one axis.

**Patch the browser.** Change the C++ so the values are native and there is no
JavaScript to find. Highest fidelity, highest cost: a browser fork to maintain
and rebuild on every upstream release.

**Patch from outside.** Use the protocol the browser already offers, and fall
back to JavaScript where the protocol has no command. Cheap, portable, and
detectable in proportion to how much falls into the JavaScript bucket.

Browser Commander is firmly in the second camp, with one refinement that turns
out to matter more than the camp itself: **prefer the switch to the protocol,
and the protocol to the script.** The measured gap between a real Chrome and an
automated one was two boolean fields, and the fix for both is a launch switch.
No JavaScript was needed to reach zero differences.

## Projects

### puppeteer-extra-plugin-stealth

The original, and the reason the whole category exists. A collection of
"evasions", each patching one surface from a page init script:
`navigator.webdriver`, `navigator.plugins`, `navigator.languages`,
`window.chrome`, the WebGL vendor, `iframe.contentWindow`, and the
`Notification.permission` inconsistency.

*Taken:* the evasion-per-surface structure, and the insistence that a patch
must survive `Function.prototype.toString`. The
`FINGERPRINT_LIMITATIONS` list is the same idea inverted -- one entry per
surface that *cannot* be fixed.

*Rejected:* patching `navigator.webdriver` in JavaScript as the primary
mechanism. Measurement 2 shows the property comes from a Blink runtime feature
with a launch switch that turns it off at the source, which needs no script, no
descriptor forgery, and reaches workers. The JavaScript getter is kept only for
the case the switch cannot cover -- attaching to a browser somebody else
launched -- and is documented as the weaker option it is.

Its unmaintained state is also a lesson: an evasion list is a snapshot of one
Chrome version's quirks and rots without continuous measurement. That is the
argument for shipping the probe and the diff as a test rather than shipping a
list of fixes.

### rebrowser-patches

Targets the `Runtime.enable` leak: to get an execution context id, an engine
enables the Runtime domain, after which the inspector serialises console
arguments -- reading `Error.prototype.stack` -- so a page can install a getter
and watch it fire.

*Tested, not assumed.* Measurement 7 reproduces their detector, including the
control they do not publish: the CDP session counts
`Runtime.consoleAPICalled` events. On Chrome 149.0.7827.155 the control
receives 34 events, proving the domain is on and forwarding, and the stack
getter never fires. Neither engine leaks before or after `page.evaluate`. The
console-serialisation variant appears closed on this build.

*Taken:* the detector, kept as a script rather than a conclusion, so the next
person can re-run it on a newer Chrome and get an answer.

*Not adopted:* patching the engines. It would mean vendoring Puppeteer and
Playwright internals, and on the current Chrome there is nothing to fix.

### Patchright

A Playwright fork that avoids `Runtime.enable` by running everything in
isolated execution contexts, injecting init scripts through request
interception instead of `Page.addScriptToEvaluateOnNewDocument`, and -- per its
own documentation -- disabling the Console API outright.

*Rejected, and the reason is instructive:* a browser whose `console.debug` does
not behave like `console.debug` is itself anomalous. Suppressing a detector by
breaking the API it observes trades a signal you know about for one you do not.

*Taken:* the idea that init-script delivery is a design choice with detection
consequences, not an implementation detail.

### undetected-chromedriver

Patches the ChromeDriver binary to remove the `cdc_` variables it injects into
every document, and strips automation switches.

*Not applicable:* this repository never uses ChromeDriver, so the `cdc_`
variables do not exist. The measured leak is the debugging transport, which
undetected-chromedriver does not address because ChromeDriver's transport is
different.

*Taken:* the confirmation that the fix belongs at the launch layer.

### nodriver

Successor to undetected-chromedriver. Drops the automation library entirely and
talks raw CDP to an unmodified Chrome, so there is no engine adding default
switches.

*Directly relevant.* Measurement 1's `cdpAttach` scenario is this design, and
it shows **0 differences with no parity switches at all** -- attaching to plain
Chrome over a *fixed* debugging port is clean, because
`runtime_features.cc` treats a fixed port as a human with a debugger and only
an ephemeral port as ChromeDriver.

*Taken:* the repository already ships this shape as `launchRealBrowser`, and
the measurement is now the argument for it.

*Rejected as the only option:* the cost is losing Playwright and Puppeteer. The
finding here is that you do not have to choose -- a launch switch gets the
engines to the same place.

### Camoufox

A patched Firefox that implements fingerprint spoofing in C++, so WebGL, canvas
and audio values are native and no JavaScript hijack exists to detect.

*The honest comparison.* This is strictly stronger for the surfaces Browser
Commander lists as limitations -- canvas, audio, fonts, WebGL numeric limits --
because those *cannot* be done convincingly from outside the browser, which is
exactly why they are limitations rather than features.

*Rejected:* a browser fork is a different project. The cost is rebuilding
Firefox on every release and shipping a browser binary.

*Taken:* the reasoning about noise. Camoufox's argument for doing canvas at the
C++ level is that JavaScript-level canvas noise is detectable because a real
browser returns the same digest twice and a noised one does not. That is the
recorded reason `canvas-audio-font-follow-the-host` says to match the host
rather than to add noise.

### Apify fingerprint-suite

The most complete work on the *generation* half: `fingerprint-generator`
samples internally consistent fingerprints from a Bayesian network trained on
real telemetry, `header-generator` produces matching HTTP headers, and
`fingerprint-injector` applies them to Playwright or Puppeteer.

*The strongest idea available, and the one this repository is weakest on.*
Consistency is the hard part: `navigator.platform` saying `MacIntel` while
`Sec-CH-UA-Platform` says Windows is worse than changing nothing, and sampling
from real telemetry gets consistency for free while a hand-written preset gets
it only where somebody thought of it.

*Taken:* the four presets and the cross-field validation are a hand-rolled,
much smaller version of the same principle -- `createFingerprintPreset` derives
client hints from the user agent with `deriveUserAgentData` rather than letting
a caller set them independently.

*Planned:* profiles are plain data, so a generator that emits Browser Commander
profiles is an obvious integration and needs nothing new in the library. The
statistical half is genuinely out of scope for this repository -- it needs a
telemetry corpus -- and pretending otherwise would be the wrong call.

### selenium-stealth, playwright_stealth

Ports of the puppeteer-extra evasion list to Selenium and to Python Playwright.
Both are largely unmaintained.

*Taken:* the confirmation that R5 -- do this in every supported language -- is
the right requirement. The reason these ports rot is that they are copies of a
list rather than shared logic with shared tests. That is the argument for the
port plan in [`requirements.md`](./requirements.md#r5-all-supported-programming-languages):
one init-script asset, byte-identical across the three implementations and
checked in CI, rather than three hand-maintained translations.

### The detector projects

`rebrowser-bot-detector`, `CreepJS`, `fingerprint.js`. Not solutions -- these
are the adversary, and they are more useful than the solutions.

*Taken:* `probe.js` is a detector in the same tradition, with one deliberate
difference. A public detector scores a browser against a model of what is
normal. `probe.js` does not score anything: it dumps state, and the *diff*
against a hand-started Chrome decides. There is no threshold to argue with and
no model to be wrong, which is what makes "exactly 0 difference" a testable
claim rather than a slogan.

## What this survey changed

1. **The launch switch is the fix, not the init script.** Nearly every project
   above patches `navigator.webdriver` in JavaScript.
   `content/child/runtime_features.cc` shows it is a Blink runtime feature with
   a switch that disables it at the source, and measurement 1 shows that switch
   is sufficient. Zero differences, no script.
2. **Removing `--enable-automation` is cargo cult.** It is the most repeated
   advice in the category, and measurement 1 shows it changes nothing: the
   debugging transport is what sets the property. It is still worth removing --
   it is what shows the infobar -- but not as a parity fix.
3. **Test the claims.** The `Runtime.enable` leak is treated as settled fact
   across this literature. It did not reproduce on Chrome 149 even with the
   domain explicitly enabled and 34 console events observed.
4. **State limitations instead of faking them.** Every project that patches
   canvas or WebGL numeric values from JavaScript makes the browser more
   identifiable, not less. `limitations.js` says so, per surface, with the
   evidence attached.

## Sources

- [puppeteer-extra-plugin-stealth](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth)
- [rebrowser-patches](https://github.com/rebrowser/rebrowser-patches) and [rebrowser-bot-detector](https://github.com/rebrowser/rebrowser-bot-detector)
- [How to fix Runtime.Enable CDP detection](https://rebrowser.net/blog/how-to-fix-runtime-enable-cdp-detection-of-puppeteer-playwright-and-other-automation-libraries)
- [Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) and [patchright-python](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-python)
- [undetected-chromedriver](https://github.com/ultrafunkamsterdam/undetected-chromedriver)
- [nodriver](https://github.com/ultrafunkamsterdam/nodriver)
- [Camoufox](https://github.com/daijro/camoufox) and [Camoufox fingerprint injection](https://camoufox.com/fingerprint/)
- [apify/fingerprint-suite](https://github.com/apify/fingerprint-suite) and [Generating fingerprints](https://docs.apify.com/academy/anti-scraping/mitigation/generating-fingerprints)
- [Chromium `content/child/runtime_features.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/child/runtime_features.cc)
- [Chrome DevTools Protocol, Emulation domain](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/)
- [User-Agent Client Hints](https://wicg.github.io/ua-client-hints/)
- [Bugzilla 1632821: navigator.webdriver should no longer depend on the marionette.enabled preference](https://bugzilla.mozilla.org/show_bug.cgi?id=1632821)
