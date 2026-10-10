import fs from 'node:fs/promises';
import {
  probeSession,
  closeRemoteBrowser,
  acquireLease,
} from './persistent-session.js';
const [, , file, token] = process.argv;
const read = () =>
  fs
    .readFile(file, 'utf8')
    .then(JSON.parse)
    .catch(() => null);
while (true) {
  const session = await read();
  if (session?.token !== token) {
    break;
  }
  await new Promise((resolve) =>
    setTimeout(
      resolve,
      Math.min(30_000, Math.max(100, session.idleTimeoutMs / 10))
    )
  );
  const current = await read();
  if (current?.token !== token) {
    break;
  }
  if (Date.now() - current.lastActive < current.idleTimeoutMs) {
    continue;
  }
  let release;
  try {
    release = await acquireLease(`${file}.lock`);
  } catch {
    continue;
  }
  try {
    const version = await probeSession(
      `http://127.0.0.1:${current.remoteDebuggingPort}`
    );
    const latest = await read();
    if (latest?.token !== token) {
      break;
    }
    if (Date.now() - latest.lastActive < latest.idleTimeoutMs) {
      continue;
    }
    if (!version) {
      try {
        process.kill(current.pid, 0);
        continue;
      } catch (error) {
        if (error.code !== 'ESRCH') {
          continue;
        }
      }
    } else if (version.webSocketDebuggerUrl === current.webSocketDebuggerUrl) {
      try {
        await closeRemoteBrowser(version.webSocketDebuggerUrl);
      } catch {
        continue;
      }
    }
    if ((await read())?.token === token) {
      await fs.rm(file, { force: true });
    }
    break;
  } finally {
    await release();
  }
}
