import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parse } from 'yaml';

import { readRepoText } from '../../helpers/repo.js';

describe('trusted publishing configuration', () => {
  const rust = parse(readRepoText('.github/workflows/rust.yml'));

  for (const jobId of ['auto-release', 'manual-release']) {
    it(`${jobId} uses a fresh OIDC token only when publishing`, () => {
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
        publish.env.CARGO_REGISTRY_TOKEN,
        '${{ steps.crates_auth.outputs.token }}'
      );
      assert.ok(job.steps.indexOf(auth) < job.steps.indexOf(publish));
      assert.ok(
        job.steps.indexOf(auth) >
          job.steps.findIndex((step) => step.name === 'Build release')
      );
    });
  }

  it('never reads the long-lived Cargo secret in the Rust workflow', () => {
    assert.doesNotMatch(
      readRepoText('.github/workflows/rust.yml'),
      /secrets\.CARGO_TOKEN/
    );
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
