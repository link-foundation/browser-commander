// A supervisor that detaches its managed child and then simply ends: the child
// must survive, and must not keep this process alive.
// usage: node detach-launcher.mjs <marker-file>
import { startProcess } from '../../js/src/utilities/subprocess.js';

const child = startProcess(process.execPath, [
  '-e',
  'setTimeout(() => require("node:fs").writeFileSync(process.argv[1], "survived"), 2000)',
  process.argv[2],
]);
await new Promise((resolve) => setTimeout(resolve, 100));
console.log(JSON.stringify({ pid: child.pid, detached: child.detach() }));
