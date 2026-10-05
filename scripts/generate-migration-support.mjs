/** Generate the native import matrix from byte-identical package declarations. */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const BEGIN_MARKER = '<!-- migration-support:generated:begin -->';
export const END_MARKER = '<!-- migration-support:generated:end -->';

export function readCapabilities(root) {
  return JSON.parse(
    readFileSync(
      path.join(root, 'js/src/browser/migration/capabilities.json'),
      'utf8'
    )
  );
}

export function renderMigrationSupport(capabilities) {
  const headers = ['Source family', 'Target family', ...capabilities.classes];
  const rows = capabilities.sourceFamilies.flatMap((source) =>
    capabilities.targetFamilies.map((target) => [
      source,
      target,
      ...(capabilities.imports[source]?.[target] ??
        capabilities.classes.map(() => 'unsupported')),
    ])
  );
  const widths = headers.map((header, column) =>
    Math.max(header.length, 3, ...rows.map((row) => row[column].length))
  );
  const line = (cells) =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`;
  return [
    line(headers),
    line(widths.map((width) => '-'.repeat(width))),
    ...rows.map(line),
  ].join('\n');
}

function main() {
  const root = process.cwd();
  const filename = path.join(root, 'docs/profile-migration.md');
  const current = readFileSync(filename, 'utf8').replaceAll('\r\n', '\n');
  const begin = current.indexOf(BEGIN_MARKER);
  const end = current.indexOf(END_MARKER);
  if (begin < 0 || end < begin) {
    throw new Error('Missing migration-support markers');
  }
  const next = `${current.slice(0, begin + BEGIN_MARKER.length)}\n\n${renderMigrationSupport(readCapabilities(root))}\n\n${current.slice(end)}`;
  if (process.argv.includes('--check')) {
    if (next !== current) {
      throw new Error('Run node scripts/generate-migration-support.mjs');
    }
  } else {
    writeFileSync(filename, next);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
