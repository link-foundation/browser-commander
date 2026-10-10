// Preload into the in-process CLI/API suites to diagnose post-test resource leaks.
// Unreferenced diagnostics do not prolong successful runs; the probe is bounded.
import { writeFileSync } from 'node:fs';

const report = () => {
  const handles = process._getActiveHandles().map((handle) => ({
    type: handle.constructor.name,
    pid: handle.pid,
    fd: handle.fd,
    localPort: handle.localPort,
    remotePort: handle.remotePort,
    destroyed: handle.destroyed,
    referenced: handle.hasRef?.() ?? handle._handle?.hasRef?.(),
  }));
  const output = {
    pid: process.pid,
    resources: process.getActiveResourcesInfo(),
    handles,
  };
  writeFileSync(
    new URL(`../../ci-logs/hang-${process.pid}.json`, import.meta.url),
    JSON.stringify(output, null, 2)
  );
  console.error(JSON.stringify(output));
};
setTimeout(report, 30_000).unref();
setTimeout(() => {
  report();
  process.exit(1);
}, 60_000).unref();
