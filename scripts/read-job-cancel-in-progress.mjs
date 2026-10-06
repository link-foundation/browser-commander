#!/usr/bin/env node
/**
 * Read each named job's effective `concurrency.cancel-in-progress`.
 *
 * scripts/check-pipeline-status.sh excuses a cancelled job only when a newer
 * commit overtook the run *and* the job is one a newer run can cancel. A job
 * with `cancel-in-progress: false` queues behind the newer run instead, so a
 * cancellation there is a timeout or a manual stop, never a supersede.
 *
 * Answers, one per job:
 *   true | false  the literal job-level value, or the workflow-level one when
 *                 the job has no group of its own (`concurrency: <group>` and
 *                 a block without the key both mean GitHub's default, false)
 *   none          neither the job nor the workflow declares a group
 *   missing       the workflow has no job by that name
 *   unknown       an `${{ }}` expression or another value read as neither
 *
 * Everything except `true` reads as "not a supersede" to the gate, so it fails
 * closed. The parser is line-based on purpose: the gate job runs before any
 * `npm ci`, and the workflows here are plain two-space block YAML.
 *
 * Adopted from the link-foundation pipeline templates
 * (scripts/read-job-cancel-in-progress.sh), in Node rather than python3 so the
 * same code runs on every test runner.
 *
 * CLI: WORKFLOW_FILE=<path> JOB_NAMES=$'a\nb' node scripts/read-job-cancel-in-progress.mjs
 * prints <job><TAB><answer> per line.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const indentation = (line) => line.length - line.trimStart().length;
const isBlank = (line) => !line.trim() || line.trim().startsWith('#');

function normalise(raw) {
  if (raw.includes('${{')) {
    return 'unknown';
  }
  const value = raw
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .toLowerCase();
  return value === 'true' || value === 'false' ? value : 'unknown';
}

function readConcurrency(lines, start, indent) {
  const rest = lines[start].split(':').slice(1).join(':').trim();
  if (rest && !rest.startsWith('#')) {
    return 'false';
  }
  let value;
  for (const line of lines.slice(start + 1)) {
    if (isBlank(line)) {
      continue;
    }
    if (indentation(line) <= indent) {
      break;
    }
    const found = line.match(/^\s*cancel-in-progress:\s*(.*)$/);
    if (found) {
      value = found[1];
    }
  }
  return value === undefined ? 'false' : normalise(value);
}

/**
 * @param {string} source workflow YAML
 * @param {string[]} names job ids (the keys of `needs`)
 * @returns {Map<string, string>}
 */
export function readCancelInProgress(source, names) {
  const lines = source.replaceAll('\r\n', '\n').split('\n');

  const workflowStart = lines.findIndex((line) => /^concurrency:/.test(line));
  const workflowLevel =
    workflowStart === -1 ? null : readConcurrency(lines, workflowStart, 0);

  const jobs = new Map();
  let inJobs = false;
  let current = null;
  lines.forEach((line, index) => {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      return;
    }
    if (!inJobs || isBlank(line)) {
      return;
    }
    if (/^[A-Za-z_]/.test(line)) {
      inJobs = false;
      return;
    }
    const declared = line.match(/^ {2}([A-Za-z_][\w.-]*):/);
    if (declared) {
      current = declared[1];
      jobs.set(current, null);
    } else if (current !== null && /^ {4}concurrency:/.test(line)) {
      jobs.set(current, readConcurrency(lines, index, 4));
    }
  });

  return new Map(
    names.map((name) => {
      if (!jobs.has(name)) {
        return [name, 'missing'];
      }
      return [name, jobs.get(name) ?? workflowLevel ?? 'none'];
    })
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.env.WORKFLOW_FILE;
  if (!file) {
    console.error('WORKFLOW_FILE is required');
    process.exit(2);
  }
  const names = (process.env.JOB_NAMES ?? '').split('\n').filter(Boolean);
  for (const [name, value] of readCancelInProgress(
    readFileSync(file, 'utf8'),
    names
  )) {
    console.log(`${name}\t${value}`);
  }
}
