import assert from 'node:assert';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import BetterSqlite3 from 'better-sqlite3';

import {
  decodeDerElement,
  decodeDerSequence,
  oidToString,
} from '../../../../src/browser/migration/firefox-der.js';
import {
  PrimaryPasswordError,
  decryptFirefoxField,
  recoverFirefoxKeyFromDatabase,
} from '../../../../src/browser/migration/firefox-nss.js';
import {
  buildKey4Database,
  encodeLoginField,
} from '../../../fixtures/firefox-nss-fixtures.mjs';

const tempDirs = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bc-nss-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('firefox-der', () => {
  it('decodes a nested SEQUENCE and OID', () => {
    // SEQUENCE { OID 1.2.840.113549.1.5.13, OCTET STRING 0x01 0x02 }
    const oid = Buffer.from([
      0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x05, 0x0d,
    ]);
    const octet = Buffer.from([0x04, 0x02, 0x01, 0x02]);
    const seq = Buffer.concat([
      Buffer.from([0x30, oid.length + octet.length]),
      oid,
      octet,
    ]);
    const decoded = decodeDerElement(seq);
    const [oidElement, octetElement] = decodeDerSequence(decoded.content);
    assert.equal(oidToString(oidElement.content), '1.2.840.113549.1.5.13');
    assert.deepEqual([...octetElement.content], [0x01, 0x02]);
  });
});

describe('recoverFirefoxKeyFromDatabase', () => {
  it('recovers the 3DES login key via PBES2 with no primary password', async () => {
    const dir = await makeTempDir();
    const { key4Path, loginKey } = buildKey4Database({ dir });
    const db = new BetterSqlite3(key4Path, { readonly: true });
    try {
      const recovered = recoverFirefoxKeyFromDatabase(db);
      assert.deepEqual(recovered, loginKey);
    } finally {
      db.close();
    }
  });

  it('round-trips a login field decryption', async () => {
    const dir = await makeTempDir();
    const { key4Path, loginKey } = buildKey4Database({ dir });
    const db = new BetterSqlite3(key4Path, { readonly: true });
    try {
      const recovered = recoverFirefoxKeyFromDatabase(db);
      const encoded = encodeLoginField({
        key: recovered,
        plaintext: 'super-secret',
      });
      assert.equal(decryptFirefoxField(encoded, recovered), 'super-secret');
    } finally {
      db.close();
    }
  });

  it('throws PrimaryPasswordError when the wrong password is supplied', async () => {
    const dir = await makeTempDir();
    const { key4Path } = buildKey4Database({
      dir,
      primaryPassword: Buffer.from('correct horse'),
    });
    const db = new BetterSqlite3(key4Path, { readonly: true });
    try {
      assert.throws(
        () => recoverFirefoxKeyFromDatabase(db, Buffer.from('wrong')),
        PrimaryPasswordError
      );
    } finally {
      db.close();
    }
  });

  it('recovers with the correct primary password', async () => {
    const dir = await makeTempDir();
    const primaryPassword = Buffer.from('correct horse');
    const { key4Path, loginKey } = buildKey4Database({ dir, primaryPassword });
    const db = new BetterSqlite3(key4Path, { readonly: true });
    try {
      assert.deepEqual(
        recoverFirefoxKeyFromDatabase(db, primaryPassword),
        loginKey
      );
    } finally {
      db.close();
    }
  });

  it('reports a helpful error when metadata is missing', async () => {
    const dir = await makeTempDir();
    const key4Path = path.join(dir, 'key4.db');
    const db = new BetterSqlite3(key4Path);
    db.exec('CREATE TABLE metadata (id TEXT, item1 BLOB, item2 BLOB)');
    db.close();
    await writeFile(path.join(dir, 'marker'), 'x');
    const readonly = new BetterSqlite3(key4Path, { readonly: true });
    try {
      assert.throws(
        () => recoverFirefoxKeyFromDatabase(readonly),
        /no password metadata/
      );
    } finally {
      readonly.close();
    }
  });
});
