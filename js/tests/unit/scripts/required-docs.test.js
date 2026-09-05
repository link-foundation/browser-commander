/**
 * The documentation gate (CI/CD best practice #12).
 *
 * The repository already checks the two mechanical properties of its
 * documentation: `scripts/check-file-line-limits.sh` scans every tracked `.md`
 * file against the 1500-line limit, and `.github/workflows/links.yml` runs
 * lychee over `./**\/*.md`, which resolves relative paths as well as URLs.
 * Neither notices a document that stopped existing, and neither notices one of
 * the three language READMEs quietly losing the section the other two still
 * have - the exact drift `docs/feature-parity.md` exists to prevent.
 *
 * The template covers only the first half of that (a required-files list in
 * `validate-docs`); the shared-section list is what a tri-language repository
 * needs on top.
 *
 * These tests pin the enforcement mechanics against a fixture built from the
 * script's own `--list` output, and pin the repository itself against the real
 * requirement table.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { BASH_AVAILABLE, repoPath, runBashScript } from '../../helpers/repo.js';

const SCRIPT = repoPath('scripts/check-required-docs.sh');

function run(args = [], options = {}) {
  return runBashScript(SCRIPT, args, options);
}

/** The requirement table, read back from the script that enforces it. */
function requirements() {
  const { status, output } = run(['--list']);
  assert.equal(status, 0, output);

  const table = new Map();
  for (const line of output.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const [file, section = ''] = line.split('\t');
    if (!table.has(file)) {
      table.set(file, []);
    }
    if (section) {
      table.get(file).push(section);
    }
  }
  return table;
}

/**
 * A throwaway tree that satisfies the table, so a test can take exactly one
 * thing away from it and watch the script notice.
 */
function fixture(table) {
  const root = mkdtempSync(path.join(tmpdir(), 'required-docs-'));
  for (const [file, sections] of table) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(
      target,
      `# Title\n\n${sections.map((section) => `## ${section}\n\nBody.\n`).join('\n')}`
    );
  }
  return root;
}

describe('check-required-docs.sh', { skip: !BASH_AVAILABLE }, () => {
  it('passes on this repository', () => {
    const { status, output } = run();
    assert.equal(status, 0, output);
  });

  it('requires the three language READMEs to share a section list', () => {
    const table = requirements();
    const js = table.get('js/README.md');
    assert.ok(js?.length, 'js/README.md carries no required sections');
    assert.deepEqual(table.get('python/README.md'), js);
    assert.deepEqual(table.get('rust/README.md'), js);
  });

  it('fails on a required document that is missing', () => {
    const table = requirements();
    const root = fixture(table);
    try {
      rmSync(path.join(root, 'python/README.md'));
      const { status, output } = run([root]);
      assert.notEqual(status, 0);
      assert.match(output, /python\/README\.md/);
      assert.match(output, /missing/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails on a required section that is missing, and names it', () => {
    const table = requirements();
    const root = fixture(table);
    const dropped = table.get('rust/README.md')[0];
    try {
      writeFileSync(
        path.join(root, 'rust/README.md'),
        `# Title\n\n${table
          .get('rust/README.md')
          .filter((section) => section !== dropped)
          .map((section) => `## ${section}\n\nBody.\n`)
          .join('\n')}`
      );
      const { status, output } = run([root]);
      assert.notEqual(status, 0);
      assert.match(output, new RegExp(`rust/README\\.md`));
      assert.ok(
        output.includes(dropped),
        `expected the report to name the missing section ${dropped}`
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads a heading only as a heading, not as prose that mentions it', () => {
    const table = requirements();
    const root = fixture(table);
    const [section] = table.get('js/README.md');
    try {
      writeFileSync(
        path.join(root, 'js/README.md'),
        `# Title\n\nSee the ${section} section below.\n\n${table
          .get('js/README.md')
          .slice(1)
          .map((heading) => `## ${heading}\n\nBody.\n`)
          .join('\n')}`
      );
      const { status } = run([root]);
      assert.notEqual(status, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
