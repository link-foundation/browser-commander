import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startTrace } from '../../../src/traces/recorder.js';
import {
  normalizePrivacyOptions,
  redactValue,
  redactHeaders,
  redactUrl,
} from '../../../src/traces/redaction.js';
import {
  createFakePage,
  createFakeCommander,
  makeSnapshot,
} from '../../helpers/trace-fixtures.js';

it('redacts JSON, form, multipart fields and credential header/query names', () => {
  const privacy = normalizePrivacyOptions();
  const cases = [
    {
      postData: JSON.stringify({
        password: 'PRIVATE_A',
        nested: { _xsrf: 'PRIVATE_B', otp: 123456 },
        public: 'visible',
      }),
    },
    { postData: 'public=visible&password=PRIVATE_A&_xsrf=PRIVATE_B' },
    {
      postData:
        '--boundary\r\nContent-Disposition: form-data; name="password"\r\n\r\nPRIVATE_A\r\n--boundary--\r\n',
    },
    {
      body: { data: JSON.stringify({ csrf: 'PRIVATE_B', public: 'visible' }) },
    },
  ];
  for (const value of cases) {
    const result = JSON.stringify(redactValue(value, privacy));
    assert.doesNotMatch(result, /PRIVATE_[AB]|123456/);
  }
  assert.equal(
    redactHeaders({ 'X-Xsrftoken': 'PRIVATE_A' }, privacy)['X-Xsrftoken'],
    '[redacted]'
  );
  assert.doesNotMatch(
    redactUrl('https://example.test/?xsrf=PRIVATE_A&csrf=PRIVATE_B', privacy),
    /PRIVATE/
  );
  assert.ok(privacy.redactSelectors.includes('input[type=hidden]'));
});

it('redacts checkpoint HTML and mutations before bundle and incremental links writes', async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-private-'));
  const page = createFakePage({
    snapshot: makeSnapshot({ html: '<div>public PRIVATE_SENTINEL</div>' }),
  });
  try {
    const trace = await startTrace({
      commander: createFakeCommander(page),
      output,
      mode: 'continuous',
      screenshots: false,
      links: { output: path.join(output, 'trace.lino'), dom: 'full' },
      privacy: { redactPatterns: [/PRIVATE_SENTINEL/g] },
    });
    page.queueMutations([
      {
        records: [
          {
            kind: 'attribute',
            target: { path: '#public' },
            value: 'public PRIVATE_SENTINEL',
          },
        ],
      },
    ]);
    const cp = await trace.checkpoint('public');
    await trace.stop();
    assert.doesNotMatch(
      await fs.readFile(path.join(output, cp.members.html), 'utf8'),
      /PRIVATE_SENTINEL/
    );
    assert.doesNotMatch(
      await fs.readFile(path.join(output, 'trace.lino'), 'utf8'),
      /PRIVATE_SENTINEL/
    );
    const mutations = await fs.readFile(
      path.join(output, 'mutations/0001.ndjson'),
      'utf8'
    );
    assert.doesNotMatch(mutations, /PRIVATE_SENTINEL/);
    assert.match(mutations, /public/);
  } finally {
    await fs.rm(output, { recursive: true, force: true });
  }
});

it('redacts escaped script values, numeric OTPs and multipart file fields', () => {
  const privacy = normalizePrivacyOptions();
  for (const postData of [
    '<script>const xsrfToken="PRIVATE_A\\"PRIVATE_B"; const otp=123456;</script>',
    '--b\r\nContent-Disposition: form-data; name="password"; filename="public.txt"\r\n\r\nPRIVATE_A\r\n--b--\r\n',
  ]) {
    assert.doesNotMatch(
      JSON.stringify(redactValue({ postData }, privacy)),
      /PRIVATE_[AB]|123456/
    );
  }
});
