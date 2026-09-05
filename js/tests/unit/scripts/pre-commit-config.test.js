/**
 * The local quality gate has to be the same gate CI uses.
 *
 * Before this test the repository claimed pre-commit hooks through husky:
 * `js/package.json` ran `"prepare": "husky || true"`, husky refused with
 * `.git can't be found` because npm runs `prepare` inside `js/`, and `|| true`
 * threw the refusal away. `git config --get core.hooksPath` stayed empty, so
 * `js/.husky/pre-commit` never ran for anyone - the same shape of failure as the
 * `|| true` that once hid a Prettier error in the release job.
 *
 * The replacement is a repository-root `.pre-commit-config.yaml` whose local
 * hooks run the exact commands the workflows run. The assertions below pin that
 * correspondence: change a lint command in a workflow without changing the hook
 * (or the other way round) and this test fails.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../..'
);
const CONFIG_PATH = path.join(REPO_ROOT, '.pre-commit-config.yaml');

/**
 * Every local hook, mapped to the workflow step it has to mirror.
 *
 * `command` is matched twice: it must appear inside the hook's `entry`, and the
 * workflow must contain a `run:` step that is exactly that command.
 */
const MIRRORED_COMMANDS = [
  { id: 'js-eslint', workflow: 'js.yml', command: 'npm run lint' },
  { id: 'js-prettier', workflow: 'js.yml', command: 'npm run format:check' },
  {
    id: 'js-duplication',
    workflow: 'js.yml',
    command: 'npm run check:duplication',
  },
  { id: 'python-ruff', workflow: 'python.yml', command: 'ruff check .' },
  {
    id: 'python-ruff-format',
    workflow: 'python.yml',
    command: 'ruff format --check .',
  },
  { id: 'python-mypy', workflow: 'python.yml', command: 'mypy src' },
  {
    id: 'rust-fmt',
    workflow: 'rust.yml',
    command: 'cargo fmt --all -- --check',
  },
  {
    id: 'rust-clippy',
    workflow: 'rust.yml',
    command: 'cargo clippy --all-targets --all-features',
  },
  {
    id: 'file-line-limits',
    workflow: 'quality.yml',
    command: 'bash scripts/check-file-line-limits.sh',
  },
  {
    id: 'shared-fingerprint-assets',
    workflow: 'quality.yml',
    command: 'bash scripts/check-shared-fingerprint-assets.sh',
  },
  {
    id: 'repo-scripts-lint',
    workflow: 'quality.yml',
    command:
      'node js/node_modules/eslint/bin/eslint.js scripts experiments rust/scripts',
  },
  {
    id: 'ci-workflow-policy',
    workflow: 'ci-policy.yml',
    command: 'node scripts/check-ci-workflows.mjs',
  },
];

/**
 * Collect the `repo: local` hooks as `id -> lines of that hook`.
 *
 * A regex reader rather than a YAML parser, for the same reason
 * `scripts/check-ci-workflows.mjs` uses one: this repository ships no YAML
 * dependency, and a policy check that needs one is a policy check that stops
 * being run.
 *
 * @param {string} text - contents of .pre-commit-config.yaml
 * @returns {Map<string, string[]>}
 */
function readLocalHooks(text) {
  const localSection = text.slice(text.indexOf('- repo: local'));
  const hooks = new Map();
  let current = null;

  for (const line of localSection.split(/\r?\n/)) {
    const id = line.match(/^\s*-\s+id:\s+(\S+)/);
    if (id) {
      current = [];
      hooks.set(id[1], current);
      continue;
    }
    if (current) {
      current.push(line);
    }
  }
  return hooks;
}

/**
 * @param {string[]} lines - the lines of one hook
 * @returns {string} the hook's `entry` value
 */
function entryOf(lines) {
  const entry = lines.find((line) => /^\s*entry:\s/.test(line));
  return entry ? entry.replace(/^\s*entry:\s+/, '').trim() : '';
}

const config = readFileSync(CONFIG_PATH, 'utf-8');
const localHooks = readLocalHooks(config);

const workflow = (name) =>
  readFileSync(path.join(REPO_ROOT, '.github', 'workflows', name), 'utf-8');

describe('local hooks run the commands CI runs', () => {
  for (const { id, workflow: file, command } of MIRRORED_COMMANDS) {
    it(`${id} runs \`${command}\`, the same as ${file}`, () => {
      const lines = localHooks.get(id);
      assert.ok(lines, `no \`${id}\` hook in .pre-commit-config.yaml`);
      assert.ok(
        entryOf(lines).includes(command),
        `${id} must run \`${command}\`; its entry is \`${entryOf(lines)}\``
      );
      assert.ok(
        workflow(file).includes(`run: ${command}\n`),
        `${file} no longer has a step running \`${command}\`; the hook and the workflow have drifted apart`
      );
    });
  }

  it('leaves no local hook unpinned', () => {
    const pinned = new Set(MIRRORED_COMMANDS.map((m) => m.id));
    const unpinned = [...localHooks.keys()].filter((id) => !pinned.has(id));
    assert.deepEqual(
      unpinned,
      [],
      'every local hook must be listed in MIRRORED_COMMANDS so it cannot drift from CI'
    );
  });

  it('never lets pre-commit append filenames to a `bash -c` entry', () => {
    // `bash -c 'cmd' a.js b.js` passes the files as $0/$1, which bash ignores:
    // the hook would keep passing while checking something else entirely.
    for (const [id, lines] of localHooks) {
      assert.ok(
        lines.some((line) => /^\s*pass_filenames:\s+false\s*$/.test(line)),
        `${id} must set pass_filenames: false`
      );
    }
  });

  it('gives clippy the flag that makes a warning fatal in CI', () => {
    // rust.yml sets RUSTFLAGS at workflow level, which is the only reason
    // `cargo clippy` without `-D warnings` is a real gate there.
    assert.ok(entryOf(localHooks.get('rust-clippy')).includes('-Dwarnings'));
    assert.ok(workflow('rust.yml').includes('RUSTFLAGS: -Dwarnings'));
  });
});

describe('the previous hook wiring is gone', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'js', 'package.json'), 'utf-8')
  );

  it('installs no git hook through a masked command', () => {
    for (const [name, command] of Object.entries(manifest.scripts)) {
      assert.ok(
        !/\|\|\s*true\s*$/.test(command),
        `npm script \`${name}\` ends in \`|| true\`, which hides its own failure`
      );
    }
  });

  it('keeps no husky wiring that cannot reach .git from js/', () => {
    // husky refuses any path containing `..` and requires `.git` in the working
    // directory, so it cannot manage a repository-root hook from this package.
    assert.equal(manifest.devDependencies.husky, undefined);
    assert.equal(manifest.devDependencies['lint-staged'], undefined);
    assert.equal(manifest['lint-staged'], undefined);
    assert.ok(!existsSync(path.join(REPO_ROOT, 'js', '.husky')));
  });
});
