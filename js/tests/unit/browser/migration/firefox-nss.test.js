import assert from 'node:assert';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

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
import { useTempDirectories } from '../../../helpers/temp-directory.js';

const makeTempDir = useTempDirectories('bc-nss-');

// Build a key4.db, open it read-only as the migration does, and hand it to
// `check` together with the fixture's `loginKey`.
async function withKey4Database(options, check) {
  const fixture = buildKey4Database({ dir: await makeTempDir(), ...options });
  const db = new BetterSqlite3(fixture.key4Path, { readonly: true });
  try {
    check(db, fixture);
  } finally {
    db.close();
  }
}

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
    await withKey4Database({}, (db, { loginKey }) => {
      const recovered = recoverFirefoxKeyFromDatabase(db);
      assert.deepEqual(recovered, loginKey);
    });
  });

  it('round-trips a login field decryption', async () => {
    await withKey4Database({}, (db) => {
      const recovered = recoverFirefoxKeyFromDatabase(db);
      const encoded = encodeLoginField({
        key: recovered,
        plaintext: 'super-secret',
      });
      assert.equal(decryptFirefoxField(encoded, recovered), 'super-secret');
    });
  });

  it('throws PrimaryPasswordError when the wrong password is supplied', async () => {
    const primaryPassword = Buffer.from('correct horse');
    await withKey4Database({ primaryPassword }, (db) => {
      assert.throws(
        () => recoverFirefoxKeyFromDatabase(db, Buffer.from('wrong')),
        PrimaryPasswordError
      );
    });
  });

  it('recovers with the correct primary password', async () => {
    const primaryPassword = Buffer.from('correct horse');
    await withKey4Database({ primaryPassword }, (db, { loginKey }) => {
      assert.deepEqual(
        recoverFirefoxKeyFromDatabase(db, primaryPassword),
        loginKey
      );
    });
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
