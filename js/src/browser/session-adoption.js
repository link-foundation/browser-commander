import fs from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from '../utilities/subprocess.js';

/** Match both the dedicated profile and fixed port before adopting ownership. */
export function matchesSessionProcess(args, options) {
  if (
    args.filter((arg) => arg.startsWith('--user-data-dir=')).length !== 1 ||
    args.filter((arg) => arg.startsWith('--remote-debugging-port=')).length !==
      1
  ) {
    return false;
  }
  const profile = args
    .find((arg) => arg.startsWith('--user-data-dir='))
    ?.slice(16);
  const port = args
    .find((arg) => arg.startsWith('--remote-debugging-port='))
    ?.slice(24);
  return (
    /^(?:google[ -]chrome(?:[ -](?:for testing|stable|beta|unstable|canary|dev))?|chrome|chromium(?:-browser)?|brave(?: browser)?|microsoft edge|msedge)(?:\.exe)?$/i.test(
      path.basename(args[0] ?? '')
    ) &&
    Boolean(profile) &&
    path.resolve(profile) === path.resolve(options.userDataDir) &&
    Number(port) === options.remoteDebuggingPort &&
    !args.some((arg) => arg.startsWith('--type='))
  );
}
export async function findSessionProcess(options) {
  if (process.platform === 'linux') {
    for (const name of await fs.readdir('/proc')) {
      if (!/^\d+$/.test(name)) {
        continue;
      }
      const args = await fs.readFile(`/proc/${name}/cmdline`, 'utf8').then(
        (text) => text.split('\0'),
        () => []
      );
      if (matchesSessionProcess(args, options)) {
        return Number(name);
      }
    }
  } else if (process.platform === 'darwin') {
    const { stdout } = await runCommand('ps', ['-axo', 'pid=,command=']);
    for (const line of stdout.split('\n')) {
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      if (!match) {
        continue;
      }
      const args = processArguments(match[2]);
      if (matchesSessionProcess(args, options)) {
        return Number(match[1]);
      }
    }
  } else if (process.platform === 'win32') {
    const { stdout } = await runCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Where-Object { $_.Name -match "^(chrome|chromium|brave|msedge)\\.exe$" } | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress',
    ]);
    const records = JSON.parse(stdout || '[]');
    for (const record of Array.isArray(records) ? records : [records]) {
      const args = processArguments(record.CommandLine ?? '');
      args[0] = record.ExecutablePath ?? args[0];
      if (matchesSessionProcess(args, options)) {
        return record.ProcessId;
      }
    }
  }
  throw new Error(
    'Cannot verify the running browser profile and port for adoption'
  );
}

/** Process listings omit argv boundaries; only accept unambiguous managed switches. */
export function processArguments(command) {
  if (
    command.match(/--user-data-dir=/g)?.length !== 1 ||
    command.match(/--remote-debugging-port=/g)?.length !== 1
  ) {
    return [];
  }
  const executable = command.match(/^"([^"\n]+)"|^(.*?)(?=\s--)/);
  const profile = command.match(
    /--user-data-dir=(?:"([^"\n]+)"|'([^'\n]+)'|(.+?))(?=\s--|$)/
  );
  const port = command.match(/--remote-debugging-port=(\d+)(?=\s|$)/);
  return [
    executable?.[1] ?? executable?.[2] ?? '',
    `--user-data-dir=${profile?.[1] ?? profile?.[2] ?? profile?.[3] ?? ''}`,
    `--remote-debugging-port=${port?.[1] ?? ''}`,
    ...(command.includes('--type=') ? ['--type=child'] : []),
  ];
}
