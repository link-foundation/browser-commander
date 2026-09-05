#!/usr/bin/env node

/**
 * Reproduce the link-checker false positive from run 33959793880.
 *
 * The old `extractBrokenUrls` in `scripts/check-web-archive.mjs` scanned the
 * whole lychee report with a bullet-line regular expression, so it also picked
 * up the URL listed under `## Redirects per input` - a healthy 302 - and the
 * job failed for a link that was never broken.
 *
 *   node experiments/ci-repro/repro-link-checker-false-positive.mjs
 */

import { extractRejectedLinks } from '../../scripts/check-web-archive.mjs';

// lychee/out.md as produced by run 33959793880 (errors: 1, redirects: 1).
const REPORT = `# Summary

| Status         | Count |
|----------------|-------|
| 🚫 Errors      | 1     |

## Errors per input

### Errors in docs/case-studies/issue-53/README.md

* [502] <https://github.com/microsoft/playwright/issues/35743> (at 94:99) | Rejected status code: 502 Bad Gateway

## Redirects per input

### Redirects in docs/case-studies/issue-33/README.md

* https://docs.github.com/actions/security-guides/using-secrets-in-github-actions --[302]--> https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
`;

/** The parser as it was before this pull request. */
function extractBrokenUrlsBefore(content) {
  const urls = [];
  const urlPattern =
    /\[(?:4\d\d|5\d\d|ERROR|TIMEOUT|UNKNOWN)\]\s+(https?:\/\/[^\s)]+)/gi;
  let match;
  while ((match = urlPattern.exec(content)) !== null) {
    const url = match[1].trim();
    if (url && !urls.includes(url)) {
      urls.push(url);
    }
  }
  const linePattern = /^\s*(?:\*|-)\s+.*?(https?:\/\/[^\s|)>\]]+)/gm;
  let lineMatch;
  while ((lineMatch = linePattern.exec(content)) !== null) {
    const url = lineMatch[1].trim().replace(/[.,;!?]+$/, '');
    if (url && !urls.includes(url) && url.startsWith('http')) {
      urls.push(url);
    }
  }
  return urls;
}

console.log('before this pull request:');
for (const url of extractBrokenUrlsBefore(REPORT)) {
  console.log(`  broken: ${url}`);
}

console.log('\nafter:');
for (const { url, status } of extractRejectedLinks(REPORT)) {
  console.log(`  rejected [${status}]: ${url}`);
}
