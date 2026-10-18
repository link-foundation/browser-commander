import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parse } from 'yaml';

import { readRepoText } from '../../helpers/repo.js';

describe('trusted publishing configuration', () => {
  const rust = parse(readRepoText('.github/workflows/rust.yml'));

  // Organization policy: trusted publishing (OIDC) first, the token secret
  // only when OIDC is unavailable.
  const FALLBACK =
    '${{ steps.crates_auth.outputs.token || secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}';

  for (const jobId of ['auto-release', 'manual-release']) {
    it(`${jobId} publishes with a fresh OIDC token, falling back to the token secret`, () => {
      const job = rust.jobs[jobId];
      assert.equal(job.permissions['id-token'], 'write');
      const auth = job.steps.find((step) => step.id === 'crates_auth');
      const publish = job.steps.find((step) => step.id === 'publish-crate');
      assert.ok(auth, 'missing crates.io authentication step');
      assert.match(
        auth.uses,
        /^rust-lang\/crates-io-auth-action@[a-f0-9]{40}$/
      );
      assert.equal(auth.if, publish.if);
      assert.equal(
        auth['continue-on-error'],
        true,
        'a trusted publishing failure must leave the token fallback reachable'
      );
      assert.equal(publish.env.CARGO_REGISTRY_TOKEN, FALLBACK);
      assert.ok(job.steps.indexOf(auth) < job.steps.indexOf(publish));
      assert.ok(
        job.steps.indexOf(auth) >
          job.steps.findIndex((step) => step.name === 'Build release')
      );
    });
  }

  it('gives the release preflight the same token fallback', () => {
    const probe = rust.jobs['release-preflight'].steps.find(
      (step) => step.name === 'Probe crates.io trusted publishing'
    );
    assert.equal(
      probe.env.CARGO_REGISTRY_TOKEN,
      '${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}'
    );
  });

  it('reads the Cargo secrets only as the trusted publishing fallback', () => {
    const uses = readRepoText('.github/workflows/rust.yml')
      .split('\n')
      .filter((line) => /secrets\.CARGO_/.test(line))
      .map((line) => line.trim());
    assert.deepEqual(uses, [
      'CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}',
      `CARGO_REGISTRY_TOKEN: ${FALLBACK}`,
      `CARGO_REGISTRY_TOKEN: ${FALLBACK}`,
    ]);
  });

  it('keeps the registered PyPI identity identical across preflight and releases', () => {
    const python = parse(readRepoText('.github/workflows/python.yml'));
    for (const jobId of [
      'release-preflight',
      'auto-release',
      'manual-release',
    ]) {
      assert.equal(python.jobs[jobId].permissions['id-token'], 'write');
      assert.equal(python.jobs[jobId].environment, undefined);
    }
  });

  it('marks the template snapshot as private without hiding the real npm package', () => {
    assert.equal(
      JSON.parse(
        readRepoText(
          'docs/case-studies/issue-55/template-snapshots/js/package.json'
        )
      ).private,
      true
    );
    assert.notEqual(JSON.parse(readRepoText('js/package.json')).private, true);
  });

  it('disables publishing for the cookie equivalence experiment only', () => {
    const fixture = readRepoText(
      'experiments/issue-128/cookie-fixture-equivalence/Cargo.toml'
    );
    const packageTable = fixture
      .split(/^\[package\]\s*$/m)[1]
      ?.split(/^\[/m)[0];
    assert.match(packageTable ?? '', /^publish\s*=\s*false\s*$/m);
    assert.doesNotMatch(
      readRepoText('rust/Cargo.toml'),
      /^publish\s*=\s*false\s*$/m
    );
  });
});
