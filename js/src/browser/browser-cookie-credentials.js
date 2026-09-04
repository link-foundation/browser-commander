import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const SAFE_STORAGE = {
  brave: {
    application: 'brave',
    folder: 'Brave Keys',
    service: 'Brave Safe Storage',
  },
  chrome: {
    application: 'chrome',
    folder: 'Chrome Keys',
    service: 'Chrome Safe Storage',
  },
  chromium: {
    application: 'chromium',
    folder: 'Chromium Keys',
    service: 'Chromium Safe Storage',
  },
  edge: {
    application: 'microsoft-edge',
    folder: 'Microsoft Edge Keys',
    service: 'Microsoft Edge Safe Storage',
  },
};

async function runCredentialCommand(command, args, environment) {
  const { stdout } = await execFile(command, args, {
    encoding: 'utf8',
    env: environment,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trim();
}

async function readLinuxSafeStoragePassword(browser, environment, runCommand) {
  const identity = SAFE_STORAGE[browser];
  try {
    const password = await runCommand(
      'secret-tool',
      ['lookup', 'application', identity.application],
      environment
    );
    if (password) {
      return password;
    }
  } catch {
    // Try KWallet before reporting that v11 key storage is unavailable.
  }
  try {
    const password = await runCommand(
      'kwallet-query',
      ['-r', identity.service, '-f', identity.folder, 'kdewallet'],
      environment
    );
    if (password) {
      return password;
    }
  } catch {
    // Fall through to the actionable error below.
  }
  throw new Error(
    `Could not read ${identity.service} from libsecret or KWallet; install secret-tool or unlock the browser key store`
  );
}

/** Read a Chromium Safe Storage password from the platform credential store. */
export async function readSafeStoragePassword({
  browser,
  platform = process.platform,
  environment = process.env,
  runCredentialCommand: runCommand = runCredentialCommand,
}) {
  const identity = SAFE_STORAGE[browser];
  if (!identity) {
    throw new Error(`No Safe Storage identity is known for ${browser}`);
  }
  if (platform === 'darwin') {
    const password = await runCommand(
      'security',
      ['find-generic-password', '-w', '-s', identity.service],
      environment
    );
    if (!password) {
      throw new Error(`${identity.service} returned an empty password`);
    }
    return password;
  }
  if (platform === 'linux') {
    return readLinuxSafeStoragePassword(browser, environment, runCommand);
  }
  throw new Error(`Safe Storage passwords are not used on ${platform}`);
}

const DPAPI_SCRIPT = [
  '$inputBytes=[Convert]::FromBase64String($args[0])',
  '$outputBytes=[Security.Cryptography.ProtectedData]::Unprotect(',
  '  $inputBytes,$null,',
  '  [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Convert]::ToBase64String($outputBytes)',
].join(';');

/** Decrypt bytes with Windows DPAPI in the current user's security context. */
export async function decryptWindowsDpapi(
  encryptedValue,
  { environment = process.env } = {}
) {
  const output = await runCredentialCommand(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      DPAPI_SCRIPT,
      Buffer.from(encryptedValue).toString('base64'),
    ],
    environment
  );
  return Buffer.from(output, 'base64');
}

/** Recover the legacy AES-GCM key from a Chromium Local State file. */
export async function readWindowsEncryptionKey({
  localStatePath,
  environment = process.env,
  decryptDpapi = decryptWindowsDpapi,
}) {
  let state;
  try {
    state = JSON.parse(await readFile(localStatePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read Chromium Local State: ${error.message}`, {
      cause: error,
    });
  }
  const encoded = state.os_crypt?.encrypted_key;
  if (!encoded) {
    throw new Error('Chromium Local State has no os_crypt.encrypted_key');
  }
  const encryptedKey = Buffer.from(encoded, 'base64');
  if (encryptedKey.subarray(0, 5).toString('ascii') !== 'DPAPI') {
    throw new Error('Chromium Local State key does not have a DPAPI prefix');
  }
  return decryptDpapi(encryptedKey.subarray(5), { environment });
}
