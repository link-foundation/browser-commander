/**
 * Shared changelog-fragment handling for the Rust crate.
 *
 * This logic used to exist twice: once here (as a standalone script wired
 * only into the `manual-release` job) and once inline in
 * `version-and-commit.mjs`, which is what `auto-release` actually runs. The
 * inline copy never deleted the fragments it consumed and ignored
 * INSERT_MARKER, so every automatic release re-published the whole backlog
 * of notes. Both callers now import from here.
 *
 * See dev/log/issues/83/pulls/84/analysis/root-causes.md, RC-C.
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  existsSync,
} from 'fs';
import { join } from 'path';

export const CHANGELOG_DIR = 'changelog.d';
export const CHANGELOG_FILE = 'CHANGELOG.md';
export const INSERT_MARKER = '<!-- changelog-insert-here -->';

/**
 * List the fragment files in a crate's changelog.d, newest-sorting last.
 * README.md documents the directory itself and is never a fragment.
 * @param {string} [cwd] - Crate root.
 * @returns {string[]} - File names, sorted.
 */
export function listFragmentFiles(cwd = '.') {
  const dir = join(cwd, CHANGELOG_DIR);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort();
}

/**
 * Strip frontmatter from markdown content.
 * @param {string} content - Markdown content potentially with frontmatter.
 * @returns {string} - Content without frontmatter.
 */
export function stripFrontmatter(content) {
  const frontmatterMatch = content.match(
    /^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/
  );
  if (frontmatterMatch) {
    return frontmatterMatch[1].trim();
  }
  return content.trim();
}

/**
 * Collect all changelog fragments into a single markdown block.
 * @param {string} [cwd] - Crate root.
 * @returns {string} - Empty string when there is nothing to release.
 */
export function collectFragments(cwd = '.') {
  const fragments = [];
  for (const file of listFragmentFiles(cwd)) {
    const content = stripFrontmatter(
      readFileSync(join(cwd, CHANGELOG_DIR, file), 'utf-8')
    );
    if (content) {
      fragments.push(content);
    }
  }
  return fragments.join('\n\n');
}

/**
 * Update CHANGELOG.md with collected fragments, creating it if absent.
 * @param {string} cwd - Crate root.
 * @param {string} version
 * @param {string} fragments
 */
export function updateChangelog(cwd, version, fragments) {
  const changelogPath = join(cwd, CHANGELOG_FILE);
  const dateStr = new Date().toISOString().split('T')[0];
  const newEntry = `\n## [${version}] - ${dateStr}\n\n${fragments}\n`;

  if (existsSync(changelogPath)) {
    let content = readFileSync(changelogPath, 'utf-8');

    if (content.includes(INSERT_MARKER)) {
      content = content.replace(INSERT_MARKER, `${INSERT_MARKER}${newEntry}`);
    } else {
      // Insert above the newest existing release so entries stay descending.
      const lines = content.split('\n');
      const insertIndex = lines.findIndex((line) => line.startsWith('## ['));

      if (insertIndex >= 0) {
        lines.splice(insertIndex, 0, newEntry);
        content = lines.join('\n');
      } else {
        content += newEntry;
      }
    }

    writeFileSync(changelogPath, content, 'utf-8');
  } else {
    writeFileSync(
      changelogPath,
      `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

${INSERT_MARKER}
${newEntry}
`,
      'utf-8'
    );
  }

  console.log(`Updated ${CHANGELOG_FILE} with version ${version}`);
}

/**
 * Remove processed changelog fragments.
 *
 * Skipping this is what made releases repeat themselves: the fragments stay
 * on disk, the next run collects them again, and the crate ships the same
 * notes under a new version number.
 * @param {string} [cwd] - Crate root.
 */
export function removeFragments(cwd = '.') {
  for (const file of listFragmentFiles(cwd)) {
    const filePath = join(cwd, CHANGELOG_DIR, file);
    unlinkSync(filePath);
    console.log(`Removed ${join(CHANGELOG_DIR, file)}`);
  }
}
