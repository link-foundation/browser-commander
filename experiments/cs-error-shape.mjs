// Probe: what does a command-stream rejection carry for a failing `git push`?
// The push classifier reads `stderr`, so it must actually be populated.
import { loadCommandStream, commandErrorText } from '../scripts/use-module.mjs';
const { $ } = await loadCommandStream();
try {
  await $`git push nonexistent-remote-xyz HEAD:main`;
  console.log('UNEXPECTED SUCCESS');
} catch (e) {
  console.log('ERR keys:', Object.keys(e));
  console.log('code:', e.code);
  console.log('message:', JSON.stringify(e.message));
  console.log('stdout:', JSON.stringify(String(e.stdout ?? '')));
  console.log('stderr:', JSON.stringify(String(e.stderr ?? '')));
  console.log('commandErrorText:', JSON.stringify(commandErrorText(e)));
}
