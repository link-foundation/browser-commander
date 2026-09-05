/**
 * Guard for the second half of the errexit change.
 *
 * Turning `errexit` on in loadCommandStream() makes a failed command reject —
 * but `command-stream`'s rejection carries only
 *
 *   message : "Command failed with exit code 101"
 *   code    : 101
 *   stdout  : ""
 *   stderr  : "error: crate version 0.10.11 is already uploaded\n"
 *
 * The diagnostic text a caller needs to branch on is in `stderr`, *not* in
 * `message`. Three release scripts were written as
 * `error.message.includes('already exists')`, which silently stops matching the
 * moment the promise actually rejects. Left unfixed, enabling errexit would
 * convert a harmless re-run over an already-published version into a red
 * release job.
 *
 * `commandErrorText()` is the shared accessor those call sites use instead.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { commandErrorText } from '../../../../scripts/use-module.mjs';

describe('commandErrorText', () => {
  it('finds text that command-stream puts in stderr rather than message', () => {
    const error = Object.assign(
      new Error('Command failed with exit code 101'),
      {
        code: 101,
        stdout: '',
        stderr: 'error: crate version 0.10.11 is already uploaded\n',
      }
    );

    assert.equal(
      error.message.includes('already uploaded'),
      false,
      'precondition: the message alone does not carry the reason'
    );
    assert.ok(commandErrorText(error).includes('already uploaded'));
  });

  it('includes stdout, which is where gh reports an existing release', () => {
    const error = Object.assign(new Error('Command failed with exit code 1'), {
      code: 1,
      stdout: '{"message":"Reference already exists"}',
      stderr: '',
    });

    assert.ok(commandErrorText(error).includes('already exists'));
  });

  it('keeps the message so an unrecognised failure is still describable', () => {
    const error = Object.assign(new Error('Command failed with exit code 7'), {
      code: 7,
      stdout: '',
      stderr: '',
    });

    assert.match(commandErrorText(error), /exit code 7/);
  });

  it('tolerates Buffer stdio, which is what capture returns without an encoding', () => {
    const error = Object.assign(new Error('Command failed with exit code 1'), {
      code: 1,
      stdout: Buffer.from('already exists'),
      stderr: Buffer.from(''),
    });

    assert.ok(commandErrorText(error).includes('already exists'));
  });

  it('does not throw on a non-command error, or on null', () => {
    assert.equal(commandErrorText(new Error('plain')), 'plain');
    assert.equal(commandErrorText(null), '');
    assert.equal(commandErrorText(undefined), '');
    // A thrown string is not an Error but must still be describable.
    assert.equal(commandErrorText('boom'), 'boom');
  });
});
