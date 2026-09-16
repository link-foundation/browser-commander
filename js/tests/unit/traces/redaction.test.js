import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  DEFAULT_REDACT_SELECTORS,
  normalizePrivacyOptions,
  redactHeaders,
  redactText,
  redactUrl,
  redactValue,
  REDACTED,
} from '../../../src/traces/redaction.js';

describe('trace redaction (issue #87)', () => {
  const privacy = normalizePrivacyOptions();

  describe('normalizePrivacyOptions', () => {
    it('should add to the safe defaults rather than replace them', () => {
      const options = normalizePrivacyOptions({
        redactSelectors: ['.secret'],
      });

      for (const selector of DEFAULT_REDACT_SELECTORS) {
        assert.ok(options.redactSelectors.includes(selector));
      }
      assert.ok(options.redactSelectors.includes('.secret'));
    });

    it('should let a caller opt out of the defaults on purpose', () => {
      const options = normalizePrivacyOptions({
        useDefaults: false,
        redactSelectors: ['.secret'],
      });

      assert.deepStrictEqual(options.redactSelectors, ['.secret']);
    });

    it('should compile string patterns into regular expressions', () => {
      const options = normalizePrivacyOptions({ redactPatterns: ['sk-\\w+'] });

      assert.strictEqual(
        redactText('key sk-live42 here', options),
        `key ${REDACTED} here`
      );
    });

    it('should refuse options that are not an object', () => {
      assert.throws(
        () => normalizePrivacyOptions('everything'),
        /privacy options must be an object/
      );
    });

    it('should refuse a redact callback that is not callable', () => {
      assert.throws(
        () => normalizePrivacyOptions({ redact: 'yes please' }),
        /privacy.redact must be a function/
      );
    });
  });

  describe('redactUrl', () => {
    it('should remove credentials, tokens and fragment tokens', () => {
      const redacted = redactUrl(
        'https://user:hunter2@example.com/report?token=abc&page=2#id_token=zz',
        privacy
      );

      assert.strictEqual(
        redacted,
        `https://${REDACTED}:${REDACTED}@example.com/report?token=${REDACTED}&page=2#id_token=${REDACTED}`
      );
      assert.ok(!redacted.includes('hunter2'));
      assert.ok(!redacted.includes('abc'));
    });

    it('should keep a URL that cannot be parsed', () => {
      assert.strictEqual(
        redactUrl('/relative/path', privacy),
        '/relative/path'
      );
    });

    it('should leave a value that is not a URL alone', () => {
      assert.strictEqual(redactUrl('', privacy), '');
      assert.strictEqual(redactUrl(null, privacy), null);
    });
  });

  describe('redactHeaders', () => {
    it('should mask authorization and cookie headers by default', () => {
      const headers = redactHeaders(
        {
          Authorization: 'Bearer secret-token',
          Cookie: 'session=abc',
          'Content-Type': 'application/json',
        },
        privacy
      );

      assert.deepStrictEqual(headers, {
        Authorization: REDACTED,
        Cookie: REDACTED,
        'Content-Type': 'application/json',
      });
    });

    it('should pass a value that is not a header map through', () => {
      assert.strictEqual(redactHeaders(null, privacy), null);
    });
  });

  describe('redactText', () => {
    it('should let a callback rewrite what is about to be persisted', () => {
      const options = normalizePrivacyOptions({
        redact: ({ value }) => value.replace('Ada Lovelace', 'a customer'),
      });

      assert.strictEqual(
        redactText('signed by Ada Lovelace', options),
        'signed by a customer'
      );
    });

    it('should reset a stateful pattern between values', () => {
      const options = normalizePrivacyOptions({
        redactPatterns: [/secret/g],
      });

      assert.strictEqual(redactText('a secret', options), `a ${REDACTED}`);
      assert.strictEqual(redactText('a secret', options), `a ${REDACTED}`);
    });
  });

  describe('redactValue', () => {
    it('should redact every string in a nested payload', () => {
      const event = {
        request: {
          url: 'https://example.com/api?access_token=live',
          headers: { authorization: 'Bearer live' },
          method: 'GET',
        },
        cookie: 'session=abc',
        sizes: [1, 2, 3],
      };

      const redacted = redactValue(event, privacy);

      assert.strictEqual(
        redacted.request.url,
        `https://example.com/api?access_token=${REDACTED}`
      );
      assert.strictEqual(redacted.request.headers.authorization, REDACTED);
      assert.strictEqual(redacted.request.method, 'GET');
      assert.strictEqual(redacted.cookie, REDACTED);
      assert.deepStrictEqual(redacted.sizes, [1, 2, 3]);
      assert.ok(!JSON.stringify(redacted).includes('live'));
    });

    it('should leave values that carry no text unchanged', () => {
      assert.strictEqual(redactValue(42, privacy), 42);
      assert.strictEqual(redactValue(null, privacy), null);
      assert.strictEqual(redactValue(true, privacy), true);
    });
  });
});
