/**
 * The generated feature-parity matrix (issue #104).
 *
 * `scripts/generate-feature-parity.mjs` builds the per-language matrix in
 * docs/feature-parity.md from the `feature-parity:` tags in the three test
 * suites, and fails when a feature is tested in one language and missing in
 * another without a reason in docs/feature-parity/limitations.json. These
 * tests pin those rules against a fixture tree, then pin the repository
 * itself: the committed document must be what the generator writes.
 *
 * Fixture tags are assembled at run time, because the generator scans this
 * file too and a literal tag here would claim a feature.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import { repoPath } from '../../helpers/repo.js';

const {
  BEGIN_MARKER,
  END_MARKER,
  escapeCell,
  generate,
  parseTags,
  renderTable,
} = await import(
  pathToFileURL(repoPath('scripts/generate-feature-parity.mjs'))
);

const TAG = ['feature', 'parity:'].join('-');

function tag(comment, ids) {
  return `${comment} ${TAG} ${ids
    .split(/[\s,]+/u)
    .filter(Boolean)
    .map((id) => `${id}@native-typed`)
    .join(' ')}\n`;
}

function fixture({ tests, limitations = [] }) {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'feature-parity-'));
  const write = (relative, content) => {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };
  write(
    'docs/feature-parity/features.json',
    JSON.stringify({
      sections: [
        {
          title: 'Launch',
          features: [
            { id: 'launch.real', title: 'Real launch' },
            { id: 'launch.attach', title: 'Attach | snapshot' },
          ],
        },
      ],
    })
  );
  write(
    'docs/feature-parity/limitations.json',
    JSON.stringify(limitations, null, 2)
  );
  write(
    'docs/feature-parity.md',
    `# Parity\n\nprose\n\n${BEGIN_MARKER}\n${END_MARKER}\n\ntail\n`
  );
  for (const [relative, content] of Object.entries(tests)) {
    write(relative, content);
  }
  return root;
}

function inspectFixture(options, assertion) {
  const root = fixture(options);
  try {
    assertion(generate(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const ALL_LANGUAGES = {
  'js/tests/unit/launch.test.js': tag('//', 'launch.real launch.attach'),
  'python/tests/unit/test_launch.py': tag('#', 'launch.real, launch.attach'),
  'rust/src/launch.rs': `fn x() {}\n${tag('    //', 'launch.real')}${tag('//', 'launch.attach')}`,
};

describe('feature parity generator', () => {
  it('reads space- and comma-separated tags from line comments only', () => {
    assert.deepEqual(parseTags(tag('//', 'a.b c-d')), [
      'a.b@native-typed',
      'c-d@native-typed',
    ]);
    assert.deepEqual(parseTags(tag('  #', 'a.b,c.d')), [
      'a.b@native-typed',
      'c.d@native-typed',
    ]);
    assert.deepEqual(parseTags(`const s = '${tag('//', 'a.b').trim()}';`), []);
    assert.deepEqual(parseTags(tag('//', 'a.b').replaceAll('\n', '\r\n')), [
      'a.b@native-typed',
    ]);
  });

  it('escapes both Markdown pipes and backslashes in feature names', () => {
    assert.equal(escapeCell('a\\b|c\nx'), 'a\\\\b\\|c x');
  });

  it('accepts a generated document checked out with CRLF endings', () => {
    const root = fixture({ tests: ALL_LANGUAGES });
    try {
      const documentPath = path.join(root, 'docs/feature-parity.md');
      const { next } = generate(root);
      fs.writeFileSync(documentPath, next.replaceAll('\n', '\r\n'));
      const generated = generate(root);
      assert.equal(generated.current, generated.next);
      assert.equal(generated.next.includes('\r'), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('pads tables so the output is stable under Prettier', () => {
    assert.equal(
      renderTable(['A', 'Long header'], [['wide cell', 'x']]),
      [
        '| A         | Long header |',
        '| --------- | ----------- |',
        '| wide cell | x           |',
      ].join('\n')
    );
  });

  it('writes a matrix with links to the claiming tests', () => {
    const root = fixture({ tests: ALL_LANGUAGES });
    try {
      const { next, errors } = generate(root);
      assert.deepEqual(errors, []);
      assert.match(next, /^# Parity\n\nprose\n\n<!-- feature-parity/u);
      assert.match(
        next,
        /\| Real launch +\| \[Native typed\]\(\.\.\/js\/tests\/unit\/launch\.test\.js\) +\| \[Native typed\]\(\.\.\/python\/tests\/unit\/test_launch\.py\) +\| \[Native typed\]\(\.\.\/rust\/src\/launch\.rs\) +\|/u
      );
      assert.match(next, /Attach \\\| snapshot/u);
      assert.match(next, /None: every feature is tested in every language/u);
      assert.match(next, /\n\ntail\n$/u);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails on a gap without a limitation', () => {
    const tests = { ...ALL_LANGUAGES };
    tests['rust/src/launch.rs'] = tag('//', 'launch.real');
    const root = fixture({ tests });
    try {
      const { errors, next } = generate(root);
      assert.deepEqual(errors, [
        'feature "launch.attach" is tested in javascript, python but not in ' +
          'rust, and docs/feature-parity/limitations.json gives no reason',
      ]);
      assert.match(next, /\| Missing +\|/u);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts a gap with a technical reason and links to it', () => {
    const tests = { ...ALL_LANGUAGES };
    tests['rust/src/launch.rs'] = tag('//', 'launch.real');
    const root = fixture({
      tests,
      limitations: [
        {
          id: 'rust-no-attach',
          features: ['launch.attach'],
          languages: ['rust'],
          reason: 'The crate has no WebSocket server.',
        },
      ],
    });
    try {
      const { errors, next } = generate(root);
      assert.deepEqual(errors, []);
      assert.match(next, /\[Limitation\]\(#rust-no-attach\)/u);
      assert.match(
        next,
        /<a id="rust-no-attach"><\/a>\*\*`rust-no-attach`\*\* \(Rust\): The crate has no WebSocket server\./u
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a claim without an API tier', () => {
    inspectFixture(
      {
        tests: {
          ...ALL_LANGUAGES,
          'js/tests/unit/legacy.test.js': `// ${TAG} launch.real\n`,
        },
      },
      ({ errors }) => {
        assert.ok(errors.some((error) => /has no valid API tier/u.test(error)));
      }
    );
  });

  it('requires a technical reason for untyped CLI access', () => {
    inspectFixture(
      {
        tests: {
          ...ALL_LANGUAGES,
          'rust/src/launch.rs': `// ${TAG} launch.real@untyped-via-cli launch.attach@native-typed\n`,
        },
      },
      ({ errors }) => {
        assert.ok(
          errors.some((error) => /below typed via bridge/u.test(error))
        );
      }
    );
  });

  it('renders typed bridge access and a documented CLI exception', () => {
    inspectFixture(
      {
        tests: {
          ...ALL_LANGUAGES,
          'python/tests/unit/test_launch.py': `# ${TAG} launch.real@typed-via-bridge launch.attach@native-typed\n`,
          'rust/src/launch.rs': `// ${TAG} launch.real@untyped-via-cli launch.attach@native-typed\n`,
        },
        limitations: [
          {
            id: 'dynamic-launch',
            features: ['launch.real'],
            languages: ['rust'],
            tier: 'untyped-via-cli',
            reason: 'This command accepts a dynamic JSON script.',
          },
        ],
      },
      ({ errors, next }) => {
        assert.deepEqual(errors, []);
        assert.match(
          next,
          /\[Typed via bridge\]\(\.\.\/python\/tests\/unit\/test_launch\.py\)/u
        );
        assert.match(
          next,
          /\[Untyped via CLI\]\(\.\.\/rust\/src\/launch\.rs\) \(\[reason\]\(#dynamic-launch\)\)/u
        );
      }
    );
  });

  it('rejects a stale CLI exception that has no claim', () => {
    inspectFixture(
      {
        tests: {
          ...ALL_LANGUAGES,
          'rust/src/launch.rs': tag('//', 'launch.attach'),
        },
        limitations: [
          {
            id: 'stale-cli-exception',
            features: ['launch.real'],
            languages: ['rust'],
            tier: 'untyped-via-cli',
            reason: 'Dynamic JSON input.',
          },
        ],
      },
      ({ errors }) => {
        assert.ok(
          errors.some((error) => /expects untyped CLI access/u.test(error))
        );
      }
    );
  });

  it('rejects stale, reasonless and unknown entries', () => {
    const tests = {
      ...ALL_LANGUAGES,
      'js/tests/unit/extra.test.js': tag('//', 'launch.unknown'),
    };
    const root = fixture({
      tests,
      limitations: [
        {
          id: 'stale',
          features: ['launch.real', 'launch.missing'],
          languages: ['rust', 'cobol'],
          reason: ' ',
        },
      ],
    });
    try {
      const { errors } = generate(root);
      assert.deepEqual(errors.sort(), [
        'limitation "stale" covers launch.real in rust, but rust/src/launch.rs tests it; remove the stale entry',
        'limitation "stale" gives no technical reason',
        'limitation "stale" names unknown feature "launch.missing"',
        'limitation "stale" names unknown language "cobol"',
        'unknown feature "launch.unknown" claimed by js/tests/unit/extra.test.js; add it to docs/feature-parity/features.json',
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps docs/feature-parity.md in sync with the tests', () => {
    const { current, next, errors } = generate(repoPath());
    assert.deepEqual(errors, []);
    assert.equal(
      current,
      next,
      'run node scripts/generate-feature-parity.mjs and commit the result'
    );
  });
});
