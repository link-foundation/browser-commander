import { writeFileSync } from 'node:fs';

// A bounded model of Chrome flushing its profile while handling SIGTERM.
const marker = process.argv[2];
let stopping = false;
process.on('SIGTERM', () => {
  if (stopping) {
    return;
  }
  stopping = true;
  setTimeout(() => {
    writeFileSync(marker, 'flushed');
    process.exit(0);
  }, 100);
});
setTimeout(() => process.exit(2), 5000);
process.stdout.write('ready\n');
