/**
 * The link checker used to fail pull requests for links that were not broken.
 *
 * Run 33959793880 is the reference case: lychee reported exactly one error, a
 * `[502]` on a GitHub issue that answered 200 minutes later, and listed a
 * healthy `[302]` redirect in a separate section. Both were reported as broken
 * links with no archived copy, and the job failed. The fixture below is that
 * report; the assertions pin each step of the decision that now keeps such a
 * run green while still failing on a link that is really gone.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyStatus,
  extractRejectedLinks,
  judge,
} from '../../../../scripts/check-web-archive.mjs';

// Verbatim shape of lychee/out.md from run 33959793880.
const REPORT = `# Summary

| Status         | Count |
|----------------|-------|
| 🔍 Total       | 170   |
| 🔗 Unique      | 123   |
| ✅ Successful  | 166   |
| ⏳ Timeouts    | 0     |
| 🔀 Redirected  | 1     |
| 👻 Excluded    | 3     |
| ❓ Unknown     | 0     |
| 🚫 Errors      | 1     |
| ⛔ Unsupported | 0     |

## Errors per input

### Errors in docs/case-studies/issue-53/README.md

* [502] <https://github.com/microsoft/playwright/issues/35743> (at 94:99) | Rejected status code: 502 Bad Gateway

## Redirects per input

### Redirects in docs/case-studies/issue-33/README.md

* https://docs.github.com/actions/security-guides/using-secrets-in-github-actions --[302]--> https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
`;

describe('reading lychee’s report', () => {
  it('takes the rejected links from the errors section only', () => {
    assert.deepEqual(extractRejectedLinks(REPORT), [
      {
        url: 'https://github.com/microsoft/playwright/issues/35743',
        status: '502',
      },
    ]);
  });

  it('never reports a redirect as broken', () => {
    const urls = extractRejectedLinks(REPORT).map((link) => link.url);
    assert.ok(
      !urls.some((url) => url.startsWith('https://docs.github.com/')),
      'a 302 listed under "Redirects per input" is a working link'
    );
  });

  it('collects every input listed under the errors section', () => {
    const report = [
      '## Errors per input',
      '',
      '### Errors in a.md',
      '',
      '* [404] <https://example.com/gone> (at 1:1) | Not Found',
      '',
      '### Errors in b.md',
      '',
      '* [ERROR] <https://example.invalid/x> (at 2:2) | dns error',
      '* [404] <https://example.com/gone> (at 3:3) | Not Found',
      '',
      '## Suggestions per input',
      '',
      '* [404] <https://example.com/not-an-error> (at 4:4)',
      '',
    ].join('\n');

    assert.deepEqual(extractRejectedLinks(report), [
      { url: 'https://example.com/gone', status: '404' },
      { url: 'https://example.invalid/x', status: 'ERROR' },
    ]);
  });
});

describe('classifying a lychee status', () => {
  it('treats a refusal to answer as saying nothing about the link', () => {
    assert.equal(classifyStatus('429'), 'transient');
    assert.equal(classifyStatus('500'), 'transient');
    assert.equal(classifyStatus('502'), 'transient');
    assert.equal(classifyStatus('503'), 'transient');
  });

  it('treats a 4xx answer as the resource being gone', () => {
    assert.equal(classifyStatus('404'), 'gone');
    assert.equal(classifyStatus('410'), 'gone');
    assert.equal(classifyStatus('403'), 'gone');
  });

  it('keeps network-level failures out of both buckets', () => {
    assert.equal(classifyStatus('ERROR'), 'unknown');
    assert.equal(classifyStatus('TIMEOUT'), 'unknown');
    assert.equal(classifyStatus('UNKNOWN'), 'unknown');
  });
});

// Stubs for the two questions `judge` asks. Naming them keeps each case below
// to the one thing it is about: what the second look said, and whether the
// Wayback Machine had a copy.
const answers = (status) => async () => ({ alive: status < 400, status });
const unreachable = () => async () => ({ alive: false, status: null });

const waybackNever = () => async () => {
  throw new Error('the Wayback Machine must not be consulted here');
};
const waybackNothing = () => async () => ({
  available: false,
  archiveUrl: null,
  timestamp: null,
});
const waybackHas = (timestamp, archiveUrl) => async () => ({
  available: true,
  archiveUrl,
  timestamp,
});

const verdictFor = (link, recheckImpl, waybackImpl) =>
  judge(link, { recheckImpl, waybackImpl });

describe('judging one rejected link', () => {
  const playwright = {
    url: 'https://github.com/microsoft/playwright/issues/35743',
    status: '502',
  };
  const gone = { url: 'https://example.com/gone', status: '404' };

  it('clears a link that answers on the second look', async () => {
    const verdict = await verdictFor(playwright, answers(200), waybackNever());
    assert.equal(verdict.verdict, 'alive');
  });

  it('does not fail for a host that is down twice', async () => {
    const verdict = await verdictFor(playwright, answers(503), waybackNever());
    assert.equal(verdict.verdict, 'transient');
  });

  it('does not fail for a host that keeps rate-limiting the runner', async () => {
    const verdict = await verdictFor(
      { url: 'https://example.com/x', status: '429' },
      answers(429),
      waybackNever()
    );
    assert.equal(verdict.verdict, 'transient');
  });

  it('suggests the snapshot when a confirmed 404 is archived', async () => {
    const verdict = await verdictFor(
      gone,
      answers(404),
      waybackHas(
        '20231015143022',
        'https://web.archive.org/web/20231015143022/https://example.com/gone'
      )
    );
    assert.equal(verdict.verdict, 'archived');
    assert.equal(verdict.date, '2023-10-15');
  });

  it('fails on a confirmed 404 with no snapshot', async () => {
    const verdict = await verdictFor(gone, answers(404), waybackNothing());
    assert.equal(verdict.verdict, 'gone');
  });

  it('still fails on a domain that no longer resolves', async () => {
    // A dead domain and a runner with no DNS look identical to lychee, so an
    // unreachable host is not waved through the way a 5xx is.
    const verdict = await verdictFor(
      { url: 'https://example.invalid/x', status: 'ERROR' },
      unreachable(),
      waybackNothing()
    );
    assert.equal(verdict.verdict, 'gone');
  });
});
