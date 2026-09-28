import {
  createCipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
} from 'node:crypto';

import BetterSqlite3 from 'better-sqlite3';

/**
 * Build the `key4.db` and `logins.json` fixtures a Firefox login-decryption
 * test needs, using the exact NSS structures (PBES2-wrapped keys, DER-wrapped
 * 3DES login fields) the production decryptor parses. Both the encryptor here
 * and the decryptor under test share the same algorithm, so a green test proves
 * the parser and the crypto agree.
 */

const OID_BYTES = Object.freeze({
  PBES2: [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x05, 0x0d],
  PBKDF2: [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x05, 0x0c],
  HMAC_SHA256: [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x02, 0x09],
  AES_256_CBC: [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x01, 0x2a],
  DES_EDE3_CBC: [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x03, 0x07],
});

function derLength(length) {
  if (length < 0x80) {
    return Buffer.from([length]);
  }
  const bytes = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value = Math.floor(value / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derElement(tag, content) {
  return Buffer.concat([
    Buffer.from([tag]),
    derLength(content.length),
    content,
  ]);
}

function derSequence(...parts) {
  return derElement(0x30, Buffer.concat(parts));
}

function derOctet(buffer) {
  return derElement(0x04, buffer);
}

function derOid(bytes) {
  return derElement(0x06, Buffer.from(bytes));
}

function derInteger(number) {
  let bytes = [];
  if (number === 0) {
    bytes = [0];
  } else {
    let value = number;
    while (value > 0) {
      bytes.unshift(value & 0xff);
      value = Math.floor(value / 256);
    }
    if (bytes[0] & 0x80) {
      bytes.unshift(0);
    }
  }
  return derElement(0x02, Buffer.from(bytes));
}

function pbes2Key(globalSalt, entrySalt, iterations, primaryPassword) {
  const passwordHash = createHash('sha1')
    .update(Buffer.concat([globalSalt, primaryPassword]))
    .digest();
  return pbkdf2Sync(passwordHash, entrySalt, iterations, 32, 'sha256');
}

function encodePbes2Blob({
  globalSalt,
  entrySalt,
  iterations,
  iv14,
  plaintext,
  primaryPassword,
}) {
  const key = pbes2Key(globalSalt, entrySalt, iterations, primaryPassword);
  const fullIv = Buffer.concat([Buffer.from([0x04, 0x0e]), iv14]);
  const cipher = createCipheriv('aes-256-cbc', key, fullIv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const kdf = derSequence(
    derOid(OID_BYTES.PBKDF2),
    derSequence(
      derOctet(entrySalt),
      derInteger(iterations),
      derInteger(32),
      derSequence(derOid(OID_BYTES.HMAC_SHA256))
    )
  );
  const enc = derSequence(derOid(OID_BYTES.AES_256_CBC), derOctet(iv14));
  const algorithmId = derSequence(
    derOid(OID_BYTES.PBES2),
    derSequence(kdf, enc)
  );
  return derSequence(algorithmId, derOctet(ciphertext));
}

function pkcs7Pad(buffer, blockSize) {
  const padLength = blockSize - (buffer.length % blockSize);
  return Buffer.concat([buffer, Buffer.alloc(padLength, padLength)]);
}

/**
 * Build a Firefox key4.db with a PBES2-wrapped 3DES login key.
 *
 * @param {Object} [options]
 * @returns {{key4Path: string, loginKey: Buffer, primaryPassword: Buffer}}
 */
export function buildKey4Database({
  dir,
  primaryPassword = Buffer.alloc(0),
  iterations = 100,
} = {}) {
  const globalSalt = randomBytes(16);
  const loginKey = randomBytes(24);

  const checkBlob = encodePbes2Blob({
    globalSalt,
    entrySalt: randomBytes(16),
    iterations,
    iv14: randomBytes(14),
    plaintext: Buffer.from('password-check\u0002\u0002', 'latin1'),
    primaryPassword,
  });
  const keyBlob = encodePbes2Blob({
    globalSalt,
    entrySalt: randomBytes(16),
    iterations,
    iv14: randomBytes(14),
    plaintext: loginKey,
    primaryPassword,
  });

  const key4Path = `${dir}/key4.db`;
  const db = new BetterSqlite3(key4Path);
  db.exec(
    'CREATE TABLE metadata (id TEXT PRIMARY KEY, item1 BLOB, item2 BLOB);' +
      'CREATE TABLE nssPrivate (a11 BLOB, a102 BLOB);'
  );
  db.prepare('INSERT INTO metadata (id, item1, item2) VALUES (?, ?, ?)').run(
    'password',
    globalSalt,
    checkBlob
  );
  db.prepare('INSERT INTO nssPrivate (a11, a102) VALUES (?, ?)').run(
    keyBlob,
    Buffer.from('f8000000000000000000000000000001', 'hex')
  );
  db.close();
  return { key4Path, loginKey, primaryPassword };
}

/**
 * Encode one NSS login field (username/password) as base64, exactly like
 * `logins.json` stores it.
 *
 * @param {Object} options
 * @param {Buffer} options.key - The 24-byte 3DES key
 * @param {string} options.plaintext
 * @returns {string}
 */
export function encodeLoginField({ key, plaintext }) {
  const iv = randomBytes(8);
  const cipher = createCipheriv('des-ede3-cbc', key, iv);
  cipher.setAutoPadding(false);
  const padded = pkcs7Pad(Buffer.from(plaintext, 'utf8'), 8);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()]);
  const ckaId = Buffer.from('f8000000000000000000000000000001', 'hex');
  return derSequence(
    derOctet(ckaId),
    derSequence(derOid(OID_BYTES.DES_EDE3_CBC), derOctet(iv)),
    derOctet(ciphertext)
  ).toString('base64');
}

/**
 * Build a `logins.json` document from plaintext credentials.
 *
 * @param {Object} options
 * @param {Buffer} options.key
 * @param {Array<{hostname: string, username: string, password: string}>} options.entries
 * @returns {string} JSON text
 */
export function buildLoginsJson({ key, entries }) {
  return JSON.stringify({
    nextId: entries.length + 1,
    logins: entries.map((entry, index) => ({
      id: index + 1,
      hostname: entry.hostname,
      encryptedUsername: encodeLoginField({ key, plaintext: entry.username }),
      encryptedPassword: encodeLoginField({ key, plaintext: entry.password }),
      guid: `{fixture-${index}}`,
    })),
  });
}
