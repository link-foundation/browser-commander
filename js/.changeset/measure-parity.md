---
'browser-commander': minor
---

Measure how far a driven browser is from the same browser started by hand
(#103).

`measureParity()` starts the binary the way a person would, reads its
chrome://version command line and runs the environment probe in it, then does
the same for the browser Browser Commander launches (or for a `session` you
pass). Every difference in the command line, in the feature switches and in
anything a page can read is tagged with the limitations-catalogue entry that
explains it or marked `requested` when it follows from an option you set; a
report with an unexplained difference is not `ok`. `parseSwitches`,
`compareCommandLines`, `classifyDifferences` and `readBrowserVersionPage` are
exported too. The parity e2e suite measures every installed Chrome-family
browser (Chrome, Chromium, Edge, Brave), headful and headless, through both
engines.

`--headless` is no longer treated as an AutomationControlled trigger, so a
headless launch no longer adds `--disable-blink-features=AutomationControlled`:
Chrome 153 keeps `navigator.webdriver` false for every `--headless` form, and
the extra switch was the one difference `measureParity()` found headless.
