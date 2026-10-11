import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Parser, StreamParser } from 'links-notation';
import {
  decodeLinkText,
  formatTraceLinks,
  timelineLink,
} from '../../../src/traces/links.js';
import { readRepoText } from '../../helpers/repo.js';

describe(
  'trace compatibility with Links Notation (issue #168)',
  { timeout: 10000 },
  () => {
    it('preserves scalar text through the formatter, parser and trace decoder', () => {
      for (const text of [
        '',
        '#comment',
        'issue#168',
        '~1{61}',
        'both\'and" with `backticks`',
        'line\r\nbreak\ttab\\literal\\u0022\\ud800\\udfff',
        '\u0000\u0001\u007f',
        'a\u00a0b\u2028c\u2029d\ufeff',
        'Tiếng Việt 日本語 🧭 e\u0301',
        '\ud800',
        '\udfff',
        '🧭\ud800🧭\udfff',
      ]) {
        const line = formatTraceLinks([
          timelineLink({ kind: 'console', text }),
        ]);
        assert.equal(line.split('\n').length, 2, 'one record per line');
        const [parsed] = new Parser().parse(line);
        const field = parsed.values.find((value) => value.id === 'text');
        assert.equal(decodeLinkText(field.values[0].id), text);
      }
    });

    it('imports the existing cross-language golden export in arbitrary chunks', () => {
      const text = readRepoText(
        'js/tests/fixtures/traces/conformance/expected/trace.lino'
      );
      const expected = new Parser().parse(text);
      assert.equal(expected.length, 27);
      for (const chunkSize of [1, 17, text.length]) {
        const stream = new StreamParser();
        for (let offset = 0; offset < text.length; offset += chunkSize) {
          stream.write(text.slice(offset, offset + chunkSize));
        }
        stream.end();
        assert.deepEqual(stream.drain(), expected);
      }
    });
  }
);
