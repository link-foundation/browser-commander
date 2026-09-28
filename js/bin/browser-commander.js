#!/usr/bin/env node
/**
 * The `browser-commander` command (issue #104). See docs/cli-and-bridge.md.
 *
 * Stdout carries exactly one JSON document (or JSON-RPC lines for
 * `serve --stdio`), so library logging is moved to stderr.
 */
import { runCli } from '../src/cli/main.js';

for (const method of ['log', 'info', 'debug']) {
  console[method] = (...args) => console.error(...args);
}

const exitCode = await runCli(process.argv.slice(2));
// Engines can keep sockets or timers alive; exit once stdout is flushed.
process.stdout.write('', () => process.exit(exitCode));
