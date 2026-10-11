// A finite child must outlive this launcher, without keeping the launcher alive.
import { startDetachedProcess } from '../../js/src/utilities/subprocess.js';

const child = await startDetachedProcess(process.execPath, [
  '-e',
  'setTimeout(() => require("node:fs").writeFileSync(process.argv[1], "survived"), 3000)',
  process.argv[2],
]);
console.log(child.pid);
