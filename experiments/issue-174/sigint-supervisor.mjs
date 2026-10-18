// An embedding supervisor whose own SIGINT handler decides to keep its child.
// usage: node sigint-supervisor.mjs <managed|caller|detach-in-handler> <pid-file>
//
// - managed: default command-stream ownership; its handler forwards SIGINT to
//   the child's process group before ours runs (the issue #174 failure).
// - detach-in-handler: same, but our handler calls detach(); too late.
// - caller: `interruption: 'caller'`; only our handler sees the interrupt.
import { writeFileSync } from 'node:fs';
import { startProcess } from '../../js/src/utilities/subprocess.js';

const [mode = 'managed', pidFile] = process.argv.slice(2);
const child = startProcess(
  process.execPath,
  ['-e', 'process.on("SIGINT",()=>process.exit(130));setInterval(()=>{},1000)'],
  mode === 'caller' ? { interruption: 'caller' } : {}
);
await new Promise((resolve) => setTimeout(resolve, 300));
writeFileSync(pidFile, String(child.pid));
process.on('SIGINT', () => {
  if (mode !== 'managed') {
    child.detach();
  }
  setTimeout(() => process.exit(130), 300);
});
process.kill(process.pid, 'SIGINT');
