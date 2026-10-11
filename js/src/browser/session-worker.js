import fs from 'node:fs/promises';
import path from 'node:path';
import { connectBrowser } from './connector.js';
import {
  connectOrLaunch,
  SESSION_METADATA,
  closeOwnedSession,
  writeSessionMetadata,
  acquireLease,
} from './persistent-session.js';
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 1024 * 1024) {
    throw new RangeError('session options exceed 1 MiB');
  }
}
const options = JSON.parse(input);
const file = path.join(path.resolve(options.userDataDir), SESSION_METADATA);
if (options.operation) {
  const release = await acquireLease(`${file}.lock`);
  try {
    let metadata;
    try {
      metadata = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
      if (
        error.code === 'ENOENT' &&
        ['close', 'touch'].includes(options.operation)
      ) {
        process.stdout.write('{}');
        process.exitCode = 0;
      } else {
        throw error;
      }
    }
    if (metadata) {
      if (metadata.token !== options.token) {
        throw new Error('Persistent session ownership changed');
      }
      if (options.operation === 'close') {
        await closeOwnedSession(file, metadata);
      } else if (options.operation === 'touch') {
        metadata.lastActive = Date.now();
        if (options.targetId) {
          metadata.targetId = options.targetId;
        }
        await writeSessionMetadata(file, metadata);
        if (options.closeNewTabs) {
          const connection = await connectBrowser({
            cdpEndpoint: `http://127.0.0.1:${metadata.remoteDebuggingPort}`,
            targetId: metadata.targetId,
            singleTab: true,
            noDefaults: true,
          });
          await connection.detach();
        }
      } else {
        throw new TypeError('Unknown session operation');
      }
      process.stdout.write('{}');
    }
  } finally {
    await release();
  }
} else {
  const session = await connectOrLaunch(options);
  await session.detach();
  const metadata = JSON.parse(await fs.readFile(file, 'utf8'));
  process.stdout.write(
    JSON.stringify({
      cdpEndpoint: session.cdpEndpoint,
      userDataDir: session.userDataDir,
      remoteDebuggingPort: session.remoteDebuggingPort,
      reused: session.reused,
      token: metadata.token,
      targetId: metadata.targetId,
      idleTimeoutMs: metadata.idleTimeoutMs,
      adopted: session.adopted,
    })
  );
}
