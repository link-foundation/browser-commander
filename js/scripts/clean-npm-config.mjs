#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function removeDeprecatedAlwaysAuth(configPath) {
  if (!configPath || !existsSync(configPath)) {
    return false;
  }

  const config = readFileSync(configPath, 'utf8');
  const lines = config.split(/\r?\n/);
  const filteredLines = lines.filter(
    (line) => !/^\s*always-auth\s*=/.test(line)
  );

  if (filteredLines.length === lines.length) {
    return false;
  }

  writeFileSync(configPath, filteredLines.join('\n'));
  return true;
}

function main() {
  const removed = removeDeprecatedAlwaysAuth(process.env.NPM_CONFIG_USERCONFIG);
  if (removed) {
    console.log('Removed deprecated always-auth from npm user config.');
  } else {
    console.log('No deprecated npm always-auth config found.');
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
