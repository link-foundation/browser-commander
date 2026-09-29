import {
  createDecipheriv,
  createHash,
  createHmac,
  pbkdf2Sync,
} from 'node:crypto';

import { readDatabaseSnapshot } from './sqlite-snapshot.js';
import {
  decodeDerElement,
  decodeDerSequence,
  oidToString,
} from './firefox-der.js';

/**
 * NSS decryption for Firefox saved logins.
 *
 * Firefox does not use OSCrypt; it stores logins in `logins.json` and protects
 * them with NSS. The decryption key lives in `key4.db`:
 *
 * - `metadata` (id `password`) holds a global salt and a password-check blob.
 * - `nssPrivate` holds the encrypted 3DES key used for the actual logins.
 *
 * Two encryption schemes appear in the wild:
 *
 * - Modern Firefox wraps the key with PKCS#5 PBES2 (PBKDF2-HMAC-SHA256 then
 *   AES-256-CBC). The PBKDF2 password is `SHA1(globalSalt + primaryPassword)`
 *   and NSS stores only 14 IV bytes, so the real 16-byte CBC IV is
 *   `0x04 0x0e` followed by those bytes.
 * - Legacy profiles use `pbeWithSha1AndTripleDES-CBC`: a SHA1-based KDF derives
 *   a 3DES key and IV directly from the global salt, the entry salt and the
 *   primary password.
 *
 * The individual login fields are always 3DES-CBC (`des-ede3-cbc`) under the
 * recovered key. If a primary password is set and no correct one is supplied,
 * the password-check fails and the caller reports `primary-password-set`
 * instead of guessing.
 *
 * References:
 * - https://searchfox.org/mozilla-central/source/security/nss (NSS sources)
 * - https://github.com/unode/firefox_decrypt (the reference algorithm)
 */

const OID = Object.freeze({
  PBES2: '1.2.840.113549.1.5.13',
  PBKDF2: '1.2.840.113549.1.5.12',
  DES_EDE3_CBC: '1.2.840.113549.3.7',
  PBE_SHA1_3DES: '1.2.840.113549.1.12.5.1.3',
});

const PASSWORD_CHECK = Buffer.from('password-check\u0002\u0002', 'latin1');

/** Thrown when a primary (master) password blocks decryption. */
export class PrimaryPasswordError extends Error {
  constructor(message = 'Firefox primary password is set') {
    super(message);
    this.name = 'PrimaryPasswordError';
  }
}

function derChildren(element) {
  return element.children ?? decodeDerSequence(element.content);
}

function integerValue(element) {
  let value = 0;
  for (const byte of element.content) {
    value = value * 256 + byte;
  }
  return value;
}

/**
 * Decrypt a PBES2 (PBKDF2-HMAC-SHA256 + AES-256-CBC) blob NSS wrote.
 *
 * @param {Object} algorithmParams - The parsed PBES2 parameters SEQUENCE
 * @param {Buffer} ciphertext
 * @param {Buffer} globalSalt
 * @param {Buffer} primaryPassword
 * @returns {Buffer}
 */
function decryptPbes2(
  algorithmParams,
  ciphertext,
  globalSalt,
  primaryPassword
) {
  const [kdf, encryptionScheme] = derChildren(algorithmParams);
  const [, pbkdf2Params] = derChildren(kdf);
  const params = derChildren(pbkdf2Params);
  const entrySalt = params[0].content;
  const iterationCount = integerValue(params[1]);
  const keyLength = integerValue(params[2]);
  const [, ivElement] = derChildren(encryptionScheme);

  // This is not password storage: key4.db fixes the scheme as
  // PBKDF2(SHA-1(globalSalt + primaryPassword)), and reading the profile
  // Firefox wrote requires reproducing it byte for byte.
  const passwordHash = createHash('sha1')
    .update(Buffer.concat([globalSalt, primaryPassword]))
    .digest();
  const key = pbkdf2Sync(
    passwordHash,
    entrySalt,
    iterationCount,
    keyLength,
    'sha256'
  );
  const iv = Buffer.concat([Buffer.from([0x04, 0x0e]), ivElement.content]);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function pkcs7Unpad(buffer) {
  const padLength = buffer[buffer.length - 1];
  if (padLength > 0 && padLength <= buffer.length) {
    return buffer.subarray(0, buffer.length - padLength);
  }
  return buffer;
}

/**
 * Decrypt the legacy pbeWithSha1AndTripleDES-CBC key blob.
 *
 * @param {Object} algorithmParams - SEQUENCE { entrySalt OCTETSTRING, iterations INT }
 * @param {Buffer} ciphertext
 * @param {Buffer} globalSalt
 * @param {Buffer} primaryPassword
 * @returns {Buffer}
 */
function decryptPbeSha1Triple3Des(
  algorithmParams,
  ciphertext,
  globalSalt,
  primaryPassword
) {
  const params = derChildren(algorithmParams);
  const entrySalt = params[0].content;

  // NSS's SHA1-based PKCS#12 KDF for pbeWithSha1AndTripleDES-CBC. The entry
  // salt is right-padded with zeros to 20 bytes, and the 3DES key and IV are
  // derived through three chained HMAC-SHA1 rounds. The format is fixed by
  // NSS, so the SHA-1 password hash cannot be swapped for a slower one.
  const hp = createHash('sha1')
    .update(Buffer.concat([globalSalt, primaryPassword]))
    .digest();
  const pes = Buffer.concat([
    entrySalt,
    Buffer.alloc(Math.max(20 - entrySalt.length, 0)),
  ]).subarray(0, 20);
  const chp = createHash('sha1')
    .update(Buffer.concat([hp, entrySalt]))
    .digest();
  const k1 = createHmac('sha1', chp)
    .update(Buffer.concat([pes, entrySalt]))
    .digest();
  const tk = createHmac('sha1', chp).update(pes).digest();
  const k2 = createHmac('sha1', chp)
    .update(Buffer.concat([tk, entrySalt]))
    .digest();
  const derived = Buffer.concat([k1, k2]);
  const key = derived.subarray(0, 24);
  const iv = derived.subarray(derived.length - 8);
  const decipher = createDecipheriv('des-ede3-cbc', key, iv);
  decipher.setAutoPadding(false);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return pkcs7Unpad(plaintext);
}

function decryptNssBlob(blob, globalSalt, primaryPassword) {
  const top = decodeDerElement(blob);
  const [algorithmId, cipherElement] = derChildren(top);
  const algorithmChildren = derChildren(algorithmId);
  const oid = oidToString(algorithmChildren[0].content);
  const params = algorithmChildren[1];
  if (oid === OID.PBES2) {
    return decryptPbes2(
      params,
      cipherElement.content,
      globalSalt,
      primaryPassword
    );
  }
  if (oid === OID.PBE_SHA1_3DES) {
    return decryptPbeSha1Triple3Des(
      params,
      cipherElement.content,
      globalSalt,
      primaryPassword
    );
  }
  throw new Error(`Unsupported NSS key algorithm ${oid}`);
}

/**
 * Recover the 3DES login key from a `key4.db` snapshot.
 *
 * @param {Object} db - An open, read-only key4.db handle
 * @param {Buffer} primaryPassword - Empty when no primary password is set
 * @returns {Buffer} The 24-byte 3DES key
 */
export function recoverFirefoxKeyFromDatabase(
  db,
  primaryPassword = Buffer.alloc(0)
) {
  const meta = db
    .prepare("SELECT item1, item2 FROM metadata WHERE id = 'password'")
    .get();
  if (!meta) {
    throw new Error('key4.db has no password metadata');
  }
  const globalSalt = Buffer.from(meta.item1);
  let check;
  try {
    check = decryptNssBlob(
      Buffer.from(meta.item2),
      globalSalt,
      primaryPassword
    );
  } catch {
    // A wrong or missing primary password makes the CBC padding check fail;
    // treat any decryption failure of the password-check blob as a locked key.
    throw new PrimaryPasswordError();
  }
  if (!check.subarray(0, PASSWORD_CHECK.length).equals(PASSWORD_CHECK)) {
    throw new PrimaryPasswordError();
  }
  const priv = db.prepare('SELECT a11, a102 FROM nssPrivate').get();
  if (!priv) {
    throw new Error('key4.db has no nssPrivate key');
  }
  const decrypted = decryptNssBlob(
    Buffer.from(priv.a11),
    globalSalt,
    primaryPassword
  );
  return decrypted.subarray(0, 24);
}

/**
 * Decrypt one NSS-protected `logins.json` field (username or password).
 *
 * @param {string} base64Value - `encryptedUsername`/`encryptedPassword`
 * @param {Buffer} key - The 24-byte 3DES key
 * @returns {string}
 */
export function decryptFirefoxField(base64Value, key) {
  const top = decodeDerElement(Buffer.from(base64Value, 'base64'));
  const [, algorithm, cipherElement] = derChildren(top);
  const algorithmChildren = derChildren(algorithm);
  const iv = algorithmChildren[1].content;
  const decipher = createDecipheriv('des-ede3-cbc', key, iv);
  decipher.setAutoPadding(false);
  const plaintext = Buffer.concat([
    decipher.update(cipherElement.content),
    decipher.final(),
  ]);
  return pkcs7Unpad(plaintext).toString('utf8');
}

/**
 * Recover the login key from a `key4.db` file path (taking a read-only
 * snapshot so a running Firefox is never disturbed).
 *
 * @param {Object} options
 * @param {string} options.key4Path
 * @param {Buffer} [options.primaryPassword]
 * @returns {Promise<Buffer>}
 */
export function recoverFirefoxKey({
  key4Path,
  primaryPassword = Buffer.alloc(0),
}) {
  return readDatabaseSnapshot({
    sourcePath: key4Path,
    read: (db) => recoverFirefoxKeyFromDatabase(db, primaryPassword),
  });
}
