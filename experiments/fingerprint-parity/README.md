# Fingerprint parity experiments (issue 79)

These scripts answer one question empirically: **what does a page see that is
different when browser-commander drives Chrome, compared to the same Chrome
started by hand?**

The reference capture never speaks CDP. Chrome is started as a plain child
process pointed at a local page; the page runs `probe.js` and POSTs the JSON
report back to a local server. Every automated capture is delivered the same
way, so a difference in the diff is a difference in the browser rather than a
difference in how the probe was invoked.

## Scripts

| Script | Question it answers |
| --- | --- |
| `probe.js` | The environment surface itself: one deterministic JSON report of everything a page can read. |
| `harness.mjs` | Probe server, reference capture, deep report diff. |
| `run-baseline.mjs` | What does each engine leak today, and does the proposed fix close it? |
| `run-flag-matrix.mjs` | Which Chrome switch flips which surface? |
| `run-remote-debugging-isolation.mjs` | Does enabling remote debugging by itself set `navigator.webdriver`? |

## Running

Chrome must be installed. On a headless machine, wrap the command in `xvfb-run`
so the headful captures have a display:

```bash
xvfb-run -a --server-args="-screen 0 1920x1080x24" \
  node experiments/fingerprint-parity/run-baseline.mjs /tmp/parity-headful.json

PARITY_HEADLESS=true xvfb-run -a --server-args="-screen 0 1920x1080x24" \
  node experiments/fingerprint-parity/run-baseline.mjs /tmp/parity-headless.json
```

Environment variables:

- `CHROME_PATH` - Chrome binary, default `/usr/bin/google-chrome`.
- `PARITY_HEADLESS=true` - run every capture with `--headless=new`.
- `BC_JS_ROOT` - package root used to resolve `playwright` / `puppeteer`,
  default `./js`.

Always run from the repository root; the scripts resolve paths relative to it.

## Findings

Recorded in [`docs/case-studies/issue-79`](../../docs/case-studies/issue-79/README.md).
