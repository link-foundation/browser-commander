#!/usr/bin/env node

/**
 * Decide whether the links lychee rejected are really broken.
 *
 * `links.yml` runs lychee with `fail: false` and lets this script decide, so
 * everything that separates "the documentation needs editing" from "a third
 * party had a bad minute" lives here. Two ways that decision used to go wrong,
 * both observed on run 33959793880:
 *
 *   1. The report was scraped with a bullet-line regular expression that had no
 *      idea which section it was in, so
 *      `https://docs.github.com/actions/security-guides/using-secrets-in-github-actions`
 *      - listed under `## Redirects per input` as a healthy 302 - was reported
 *      as a broken link with no archived copy, and failed the job.
 *   2. `[502] https://github.com/microsoft/playwright/issues/35743` was treated
 *      like a 404. A 5xx is the server saying the problem is on its side; the
 *      same URL answered 200 on the next run. Failing a pull request for it is
 *      a false positive, and the Wayback Machine cannot rescue it either -
 *      a live page that nobody has archived has no snapshot to fall back to.
 *
 * So: only the errors section is read, every rejected URL is re-checked from
 * this script, and a URL is only ever fatal when the second look agrees it is
 * gone and the Wayback Machine has nothing.
 *
 * Usage:
 *   node scripts/check-web-archive.mjs
 *
 * Environment variables:
 *   - LYCHEE_OUTPUT: path to lychee's markdown output (default: lychee/out.md)
 *   - CI_SCRIPTS_DEBUG=1: trace parsing and every verdict (default: off)
 *
 * GitHub Actions outputs:
 *   - all_archived: 'true' when nothing needs a human
 *
 * Exit codes:
 *   - 0: no link is known to be gone
 *   - 1: at least one link is gone with no archived copy
 */

import { readFileSync, appendFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';

import { debug } from './debug-print.mjs';

const WAYBACK_API = 'https://archive.org/wayback/available?url=';
const REQUEST_TIMEOUT_MS = 10000;

/**
 * Write output to the GitHub Actions output file.
 * @param {string} name - Output name
 * @param {string} value - Output value
 */
function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
  console.log(`${name}=${value}`);
}

/**
 * Extract the rejected links from lychee's markdown report.
 *
 * The report is a sequence of `## ` sections; only `## Errors per input` lists
 * failures. `## Redirects per input` and `## Summary` describe links that are
 * fine, and reading a URL out of them is how a 302 became a build failure.
 *
 * A failure line looks like:
 *   * [502] <https://example.com/x> (at 94:99) | Rejected status code: 502
 *
 * @param {string} content - lychee's markdown output
 * @returns {{url: string, status: string}[]} one entry per unique URL
 */
export function extractRejectedLinks(content) {
  const links = [];
  const seen = new Set();
  let inErrors = false;

  for (const line of content.split(/\r?\n/)) {
    // `### Errors in <file>` stays inside the section; only `## ` ends it.
    if (/^##(?!#)\s/.test(line)) {
      inErrors = /^##\s+Errors\b/i.test(line);
      debug('section', { line: line.trim(), inErrors });
      continue;
    }
    if (!inErrors) {
      continue;
    }

    const match = line.match(
      /^\s*[*-]\s+\[([^\]]+)\]\s+<?(https?:\/\/[^\s>)]+)>?/
    );
    if (!match) {
      continue;
    }

    const status = match[1].trim();
    const url = match[2].replace(/[.,;!?]+$/, '');
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    links.push({ url, status });
  }

  debug('rejected links parsed', links);
  return links;
}

/**
 * Classify a lychee status token.
 *
 * `transient` means the check said nothing about the link: the server refused
 * to answer this time (429, any 5xx). `gone` means it answered that the
 * resource is not there. `unknown` covers the network-level failures, which
 * look the same whether a domain died or a runner blinked - those go through
 * the archive check rather than being waved through.
 *
 * @param {string} status - the token inside the brackets, e.g. `502`, `ERROR`
 * @returns {'gone' | 'transient' | 'unknown'}
 */
export function classifyStatus(status) {
  const code = Number.parseInt(status, 10);
  if (Number.isNaN(code)) {
    return 'unknown';
  }
  if (code === 429 || code >= 500) {
    return 'transient';
  }
  if (code >= 400) {
    return 'gone';
  }
  return 'transient';
}

/**
 * Ask the URL itself, once, before believing the report.
 *
 * Redirects are followed: lychee rejects on the final status, and so does this.
 *
 * @param {string} url - the URL to re-check
 * @param {typeof fetch} [fetchImpl] - injection point for tests
 * @returns {Promise<{alive: boolean, status: number | null}>}
 */
export async function recheck(url, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
    });
    debug('recheck', { url, status: response.status });
    return { alive: response.status < 400, status: response.status };
  } catch (error) {
    debug('recheck failed', { url, error: error.message });
    return { alive: false, status: null };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

/**
 * Check whether a URL has an archived version in the Wayback Machine.
 * https://archive.org/help/wayback_api.php
 * @param {string} url - The URL to check
 * @param {typeof fetch} [fetchImpl] - injection point for tests
 * @returns {Promise<{available: boolean, archiveUrl: string|null, timestamp: string|null}>}
 */
export async function checkWaybackMachine(url, fetchImpl = fetch) {
  const apiUrl = `${WAYBACK_API}${encodeURIComponent(url)}`;

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetchImpl(apiUrl, {
      headers: {
        'User-Agent': 'broken-link-checker/1.0 (GitHub Actions CI)',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(`  Wayback API returned ${response.status} for ${url}`);
      return { available: false, archiveUrl: null, timestamp: null };
    }

    const data = await response.json();

    if (data.archived_snapshots?.closest?.available === true) {
      const snapshot = data.archived_snapshots.closest;
      const archiveUrl = snapshot.url.replace(/^http:\/\//, 'https://');
      return {
        available: true,
        archiveUrl,
        timestamp: snapshot.timestamp,
      };
    }

    return { available: false, archiveUrl: null, timestamp: null };
  } catch (error) {
    console.warn(
      `  Failed to check Wayback Machine for ${url}: ${error.message}`
    );
    return { available: false, archiveUrl: null, timestamp: null };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

/**
 * Format a Wayback timestamp (YYYYMMDDHHmmss) as a readable date.
 * @param {string} timestamp - e.g. "20231015143022"
 * @returns {string} - e.g. "2023-10-15"
 */
export function formatTimestamp(timestamp) {
  if (!timestamp || timestamp.length < 8) {
    return timestamp;
  }
  return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
}

/**
 * Decide the fate of one rejected link.
 *
 * @param {{url: string, status: string}} link - as parsed from the report
 * @param {{recheckImpl?: Function, waybackImpl?: Function}} [deps]
 * @returns {Promise<{url: string, status: string, verdict: 'alive' | 'transient' | 'archived' | 'gone', archiveUrl?: string, date?: string}>}
 */
export async function judge(link, deps = {}) {
  const recheckImpl = deps.recheckImpl ?? recheck;
  const waybackImpl = deps.waybackImpl ?? checkWaybackMachine;

  const second = await recheckImpl(link.url);
  if (second.alive) {
    return { ...link, verdict: 'alive' };
  }

  const kind = classifyStatus(link.status);
  if (kind === 'transient' && second.status !== null && second.status >= 500) {
    return { ...link, verdict: 'transient' };
  }
  if (kind === 'transient' && second.status === 429) {
    return { ...link, verdict: 'transient' };
  }

  const archive = await waybackImpl(link.url);
  if (archive.available) {
    return {
      ...link,
      verdict: 'archived',
      archiveUrl: archive.archiveUrl,
      date: formatTimestamp(archive.timestamp),
    };
  }
  return { ...link, verdict: 'gone' };
}

/* c8 ignore start -- exercised end to end by the links workflow */
async function main() {
  const lycheeOutput = process.env.LYCHEE_OUTPUT || 'lychee/out.md';

  console.log('=== Broken link verdicts ===\n');
  console.log(`Reading lychee output from: ${lycheeOutput}\n`);

  if (!existsSync(lycheeOutput)) {
    console.log('No lychee output file found. Skipping web archive check.');
    setOutput('all_archived', 'true');
    process.exit(0);
  }

  const rejected = extractRejectedLinks(readFileSync(lycheeOutput, 'utf-8'));

  if (rejected.length === 0) {
    console.log('No rejected URLs found in lychee output.');
    setOutput('all_archived', 'true');
    process.exit(0);
  }

  console.log(`Found ${rejected.length} rejected URL(s). Re-checking...\n`);

  const verdicts = [];
  for (const link of rejected) {
    console.log(`Checking: [${link.status}] ${link.url}`);
    const verdict = await judge(link);
    verdicts.push(verdict);
    console.log(`  -> ${verdict.verdict}`);
    // Small delay to avoid rate-limiting the Wayback API.
    await new Promise((resolve) => globalThis.setTimeout(resolve, 500));
  }

  for (const { url, status } of verdicts.filter((v) => v.verdict === 'alive')) {
    console.log(
      `::warning title=Link recovered on re-check::${url} was reported as [${status}] ` +
        `by lychee but answered normally on a second request. Nothing to fix here; ` +
        `the first check hit a transient failure.`
    );
  }

  for (const { url, status } of verdicts.filter(
    (v) => v.verdict === 'transient'
  )) {
    console.log(
      `::warning title=Link host unavailable::${url} answered [${status}] twice. ` +
        `A 429 or 5xx is the host reporting its own problem, so this run cannot ` +
        `say whether the link is valid and does not fail because of it.`
    );
  }

  const archived = verdicts.filter((v) => v.verdict === 'archived');
  for (const { url, archiveUrl, date } of archived) {
    console.log(
      `::notice title=Broken link - Web Archive available (${date})::` +
        `Broken link detected: ${url}\n` +
        `A Web Archive snapshot from ${date} is available.\n` +
        `Suggested fix: replace the broken link with the archived version:\n` +
        `  ${archiveUrl}`
    );
  }

  const gone = verdicts.filter((v) => v.verdict === 'gone');
  for (const { url, status } of gone) {
    console.log(
      `::error title=Broken link - No Web Archive fallback::` +
        `Broken link detected: ${url} (lychee reported [${status}], confirmed on re-check)\n` +
        `No archived version was found in the Wayback Machine.\n` +
        `How to fix:\n` +
        `  1. Find an updated URL for the same or equivalent content and replace the link.\n` +
        `  2. Remove the link if the content is no longer relevant.\n` +
        `  3. Add the URL to .lycheeignore if it is a known false positive (e.g. localhost, example.com).`
    );
  }

  console.log('\n=== Summary ===\n');
  for (const { url, verdict } of verdicts) {
    console.log(`  ${verdict.padEnd(9)} ${url}`);
  }

  setOutput('all_archived', gone.length === 0 ? 'true' : 'false');

  if (gone.length > 0) {
    console.log('\nAction required: fix or remove the broken links above.');
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
}
/* c8 ignore stop */
