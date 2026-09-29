#!/usr/bin/env node
/**
 * Generate the per-language matrix in docs/feature-parity.md from the tests.
 *
 * Issue #104 asks for the parity document to be generated from tests rather
 * than hand-written, and for CI to fail when a feature is supported in one
 * language and missing in another without a technical reason. This script is
 * both halves:
 *
 * - `docs/feature-parity/features.json` names every feature once, grouped in
 *   sections. It carries no status: nobody edits "Supported" by hand.
 * - A test claims a feature and its API tier with a `feature-parity:` comment,
 *   for example `// feature-parity: launch.real-browser@native-typed` in JavaScript
 *   or Rust and `# feature-parity: ...` in Python. A language supports a
 *   feature when at least one of its test files claims it.
 * - `docs/feature-parity/limitations.json` is the only way to leave a gap. An
 *   entry names the features and languages it covers and gives the technical
 *   reason; a gap with no entry, an entry for a gap that no longer exists, and
 *   an entry without a reason all fail.
 *
 * The matrix is written between the `feature-parity:generated` markers in
 * docs/feature-parity.md; everything outside the markers stays hand-written
 * prose. `--check` regenerates in memory and fails if the file differs, which
 * is what CI runs.
 *
 * Usage:
 *   node scripts/generate-feature-parity.mjs          # rewrite the document
 *   node scripts/generate-feature-parity.mjs --check  # fail on any drift
 *   node scripts/generate-feature-parity.mjs --root <dir> [--check]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LANGUAGES = Object.freeze([
  { id: 'javascript', title: 'JavaScript', roots: ['js/tests'] },
  { id: 'python', title: 'Python', roots: ['python/tests'] },
  // Rust unit tests live next to the code in `#[cfg(test)]` modules.
  { id: 'rust', title: 'Rust', roots: ['rust/tests', 'rust/src'] },
]);

const TEST_EXTENSIONS = new Set(['.js', '.mjs', '.py', '.rs']);
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'target',
  '__pycache__',
  '.venv',
]);
// Only a comment that starts its line counts, so a string that mentions the
// tag (the generator's own tests build fixtures that way) claims nothing.
const TAG_PATTERN = /^[ \t]*(?:\/\/|#)[ \t]*feature-parity:([^\n]*)/gmu;
const FEATURE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const API_TIERS = new Map([
  ['untyped-via-cli', 0],
  ['typed-via-bridge', 1],
  ['native-typed', 2],
]);
const TIER_LABELS = new Map([
  ['untyped-via-cli', 'Untyped via CLI'],
  ['typed-via-bridge', 'Typed via bridge'],
  ['native-typed', 'Native typed'],
]);

export const BEGIN_MARKER = '<!-- feature-parity:generated:begin -->';
export const END_MARKER = '<!-- feature-parity:generated:end -->';

const DOCUMENT = 'docs/feature-parity.md';
const FEATURES = 'docs/feature-parity/features.json';
const LIMITATIONS = 'docs/feature-parity/limitations.json';

function* walk(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        yield* walk(full);
      }
    } else if (TEST_EXTENSIONS.has(path.extname(entry.name))) {
      yield full;
    }
  }
}

/** Feature ids claimed by one source file. */
export function parseTags(source) {
  const ids = [];
  for (const match of source.matchAll(TAG_PATTERN)) {
    ids.push(...match[1].split(/[\s,]+/u).filter(Boolean));
  }
  return ids;
}

/**
 * Collect the claims of every test file, as
 * `Map<featureId, Map<languageId, Array<{ file, tier }>>>` with repository-relative paths.
 */
export function collectClaims(root, languages = LANGUAGES) {
  const claims = new Map();
  for (const language of languages) {
    for (const testRoot of language.roots) {
      for (const file of walk(path.join(root, testRoot))) {
        const tokens = parseTags(readFileSync(file, 'utf8'));
        const relative = path.relative(root, file).split(path.sep).join('/');
        for (const token of tokens) {
          const [id, tier] = token.split('@');
          if (!claims.has(id)) {
            claims.set(id, new Map());
          }
          const byLanguage = claims.get(id);
          if (!byLanguage.has(language.id)) {
            byLanguage.set(language.id, []);
          }
          if (
            !byLanguage
              .get(language.id)
              .some((claim) => claim.file === relative && claim.tier === tier)
          ) {
            byLanguage.get(language.id).push({ file: relative, tier });
          }
        }
      }
    }
  }
  return claims;
}

/**
 * Resolve every feature/language cell and list every rule it breaks.
 *
 * @returns {{ rows: Array, errors: string[] }}
 */
export function evaluate({
  features,
  limitations,
  claims,
  languages = LANGUAGES,
}) {
  const errors = [];
  const known = new Map();
  for (const section of features.sections) {
    for (const feature of section.features) {
      if (!FEATURE_ID.test(feature.id)) {
        errors.push(`feature id "${feature.id}" is not a dotted lowercase id`);
      }
      if (known.has(feature.id)) {
        errors.push(`feature "${feature.id}" is listed twice`);
      }
      known.set(feature.id, feature);
    }
  }

  for (const [id, byLanguage] of claims) {
    if (!known.has(id)) {
      const files = [...byLanguage.values()]
        .flat()
        .map((claim) => claim.file)
        .join(', ');
      errors.push(
        `unknown feature "${id}" claimed by ${files}; add it to ${FEATURES}`
      );
    }
  }
  for (const [id, byLanguage] of claims) {
    for (const [language, entries] of byLanguage) {
      for (const entry of entries) {
        if (!API_TIERS.has(entry.tier)) {
          errors.push(
            `feature "${id}" in ${language} at ${entry.file} has no valid API tier`
          );
        }
      }
    }
  }

  const gaps = new Map();
  const limitationIds = new Set();
  for (const limitation of limitations) {
    if (limitationIds.has(limitation.id)) {
      errors.push(`limitation "${limitation.id}" is listed twice`);
    }
    limitationIds.add(limitation.id);
    if (typeof limitation.reason !== 'string' || !limitation.reason.trim()) {
      errors.push(`limitation "${limitation.id}" gives no technical reason`);
    }
    if (
      limitation.tier !== undefined &&
      limitation.tier !== 'untyped-via-cli'
    ) {
      errors.push(
        `limitation "${limitation.id}" has invalid API tier "${limitation.tier}"`
      );
    }
    for (const language of limitation.languages || []) {
      if (!languages.some((candidate) => candidate.id === language)) {
        errors.push(
          `limitation "${limitation.id}" names unknown language "${language}"`
        );
      }
    }
    for (const featureId of limitation.features || []) {
      if (!known.has(featureId)) {
        errors.push(
          `limitation "${limitation.id}" names unknown feature "${featureId}"`
        );
      }
      for (const language of limitation.languages || []) {
        gaps.set(`${featureId}\u0000${language}`, limitation);
      }
    }
  }

  const sections = features.sections.map((section) => ({
    ...section,
    rows: section.features.map((feature) => {
      const byLanguage = claims.get(feature.id) || new Map();
      const cells = {};
      for (const language of languages) {
        const entries = byLanguage.get(language.id) || [];
        const validEntries = entries.filter((entry) =>
          API_TIERS.has(entry.tier)
        );
        validEntries.sort(
          (a, b) => API_TIERS.get(b.tier) - API_TIERS.get(a.tier)
        );
        const tier = validEntries[0]?.tier;
        const files = validEntries.map((entry) => entry.file);
        const limitation = gaps.get(`${feature.id}\u0000${language.id}`);
        if (files.length === 0 && limitation?.tier === 'untyped-via-cli') {
          errors.push(
            `limitation "${limitation.id}" expects untyped CLI access for ${feature.id} in ${language.id}, but no test claims it`
          );
        }
        if (
          files.length > 0 &&
          limitation &&
          !(tier === 'untyped-via-cli' && limitation.tier === 'untyped-via-cli')
        ) {
          errors.push(
            `limitation "${limitation.id}" covers ${feature.id} in ${language.id}, ` +
              `but ${files[0]} tests it; remove the stale entry`
          );
        }
        if (files.length > 0) {
          if (tier === 'untyped-via-cli' && !limitation) {
            errors.push(
              `feature "${feature.id}" in ${language.id} is below typed via bridge and ${LIMITATIONS} gives no technical reason`
            );
          }
          cells[language.id] = { status: 'supported', files, tier, limitation };
        } else if (limitation) {
          cells[language.id] = { status: 'limitation', limitation };
        } else {
          cells[language.id] = { status: 'missing' };
        }
      }
      const supported = languages.filter(
        (language) => cells[language.id].status === 'supported'
      );
      if (supported.length === 0) {
        errors.push(`feature "${feature.id}" is not tested in any language`);
      }
      for (const language of languages) {
        if (cells[language.id].status === 'missing') {
          errors.push(
            `feature "${feature.id}" is tested in ` +
              `${supported.map((entry) => entry.id).join(', ') || 'no language'} ` +
              `but not in ${language.id}, and ${LIMITATIONS} gives no reason`
          );
        }
      }
      return { feature, cells };
    }),
  }));

  return { sections, errors };
}

export function escapeCell(value) {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
}

/** A Markdown table padded the way Prettier pads it, so the output is stable. */
export function renderTable(header, rows) {
  const width = (text) => [...text].length;
  const widths = header.map((cell, column) =>
    Math.max(3, width(cell), ...rows.map((row) => width(row[column])))
  );
  const line = (cells) =>
    `| ${cells.map((cell, column) => cell + ' '.repeat(widths[column] - width(cell))).join(' | ')} |`;
  return [
    line(header),
    `| ${widths.map((size) => '-'.repeat(size)).join(' | ')} |`,
    ...rows.map(line),
  ].join('\n');
}

function renderCell(cell, documentDirectory) {
  if (cell.status === 'supported') {
    const link = path.posix.relative(documentDirectory, cell.files[0]);
    const label = TIER_LABELS.get(cell.tier);
    return `[${label}](${link})${cell.limitation ? ` ([reason](#${cell.limitation.id}))` : ''}`;
  }
  if (cell.status === 'limitation') {
    return `[Limitation](#${cell.limitation.id})`;
  }
  return 'Missing';
}

/** Render the generated block (without the markers). */
export function renderMatrix(
  { sections, limitations },
  { languages = LANGUAGES, documentDirectory = 'docs' } = {}
) {
  const parts = [
    '_Generated by `node scripts/generate-feature-parity.mjs` from the ' +
      '`feature-parity:` tags in the test suites. Do not edit by hand: tag a ' +
      'test, or add a reason to `docs/feature-parity/limitations.json`. ' +
      'A claim must state `@native-typed`, `@typed-via-bridge`, or ' +
      '`@untyped-via-cli`; CLI-only claims require a technical reason._',
  ];
  for (const section of sections) {
    parts.push(`### ${section.title}`);
    if (section.description) {
      parts.push(section.description);
    }
    parts.push(
      renderTable(
        ['Feature', ...languages.map((language) => language.title)],
        section.rows.map(({ feature, cells }) => [
          escapeCell(feature.title),
          ...languages.map((language) =>
            renderCell(cells[language.id], documentDirectory)
          ),
        ])
      )
    );
  }
  parts.push('### Documented gaps');
  if (limitations.length === 0) {
    parts.push('None: every feature is tested in every language.');
  } else {
    parts.push(
      'Each gap names the languages it applies to and the technical reason.'
    );
    for (const limitation of limitations) {
      const scope = (limitation.languages || [])
        .map(
          (id) => languages.find((language) => language.id === id)?.title || id
        )
        .join(', ');
      parts.push(
        [
          `<a id="${limitation.id}"></a>**\`${limitation.id}\`** (${scope}): ` +
            `${limitation.reason.trim()}`,
          ...(limitation.reference
            ? [`Reference: ${limitation.reference}`]
            : []),
          `Features: ${(limitation.features || []).map((id) => `\`${id}\``).join(', ')}.`,
        ].join('\n\n')
      );
    }
  }
  return parts.join('\n\n');
}

/** Replace the generated block of a document, keeping the prose around it. */
export function spliceDocument(document, block) {
  const begin = document.indexOf(BEGIN_MARKER);
  const end = document.indexOf(END_MARKER);
  if (begin < 0 || end < begin) {
    throw new Error(
      `${DOCUMENT} must contain ${BEGIN_MARKER} followed by ${END_MARKER}`
    );
  }
  return `${document.slice(
    0,
    begin + BEGIN_MARKER.length
  )}\n\n${block}\n\n${document.slice(end)}`;
}

export function generate(root) {
  const features = JSON.parse(readFileSync(path.join(root, FEATURES), 'utf8'));
  const limitations = JSON.parse(
    readFileSync(path.join(root, LIMITATIONS), 'utf8')
  );
  const claims = collectClaims(root);
  const { sections, errors } = evaluate({ features, limitations, claims });
  const documentPath = path.join(root, DOCUMENT);
  // Git may check Markdown out with CRLF on Windows. Compare logical content
  // using the LF endings emitted by renderMatrix, avoiding false drift.
  const current = readFileSync(documentPath, 'utf8').replaceAll('\r\n', '\n');
  const next = spliceDocument(current, renderMatrix({ sections, limitations }));
  return { documentPath, current, next, errors };
}

function main(argv) {
  const check = argv.includes('--check');
  const rootIndex = argv.indexOf('--root');
  const root =
    rootIndex >= 0
      ? path.resolve(argv[rootIndex + 1])
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { documentPath, current, next, errors } = generate(root);
  for (const error of errors) {
    console.error(`feature parity: ${error}`);
  }
  if (check) {
    if (current !== next) {
      console.error(
        `feature parity: ${DOCUMENT} is out of date; run node scripts/generate-feature-parity.mjs`
      );
      return 1;
    }
  } else if (current !== next) {
    writeFileSync(documentPath, next);
    console.log(`feature parity: wrote ${DOCUMENT}`);
  }
  return errors.length > 0 ? 1 : 0;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  process.exitCode = main(process.argv.slice(2));
}
