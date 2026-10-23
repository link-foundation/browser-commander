// How does each launch path exit? Chromium records `profile.exit_type` in
// Default/Preferences; "Crashed" makes it restore session cookies (and tabs)
// on the next start, which hides issue #187.
//
//   node experiments/issue-187/exit-type.mjs <engine> <launch> [extra-json]
//
// extra-json may set args, channel and executablePath; other keys are ignored.
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from '../../js/src/index.js';

const [engine = 'playwright', launch = 'real', extraJson = '{}'] =
  process.argv.slice(2);
const extra = JSON.parse(extraJson);
const userDataDir = fs.mkdtempSync('/tmp/bc-exit-');
const session = await launchBrowser({
  engine,
  launch,
  userDataDir,
  headless: true,
  args: extra.args,
  channel: extra.channel,
  executablePath: extra.executablePath,
});
console.log(
  'executable:',
  session.executablePath ?? session.browserProcess?.spawnfile
);
const t = Date.now();
await session.close();
console.log('close took', Date.now() - t, 'ms');
const prefs = JSON.parse(
  fs.readFileSync(path.join(userDataDir, 'Default', 'Preferences'), 'utf8')
);
console.log(
  'exit_type:',
  prefs.profile?.exit_type,
  'exited_cleanly:',
  prefs.profile?.exited_cleanly
);
fs.rmSync(userDataDir, { recursive: true, force: true });
