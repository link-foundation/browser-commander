/**
 * The release preflight: prove the registries will accept the publish before
 * anything is built.
 *
 * Run 37509328334 built, tested and versioned the Python package on main and
 * only then failed at "Publish to PyPI" with `invalid-publisher` (issue #128).
 * `scripts/preflight-credentials.sh` performs the credential half of each
 * publish up front -- the OIDC exchanges all three registries do -- and the
 * `release-preflight` job in each
 * language workflow gates the publishing jobs on it. These tests pin the rules
 * the workflows depend on (principle 16 of the link-foundation pipeline
 * templates): every failure is reported, `unknown` is never a pass in release
 * mode, report mode never blocks, and no token is ever printed. Every registry
 * is a local HTTP stub, so nothing here talks to the network.
 *
 * See docs/CI-TIMEOUT-BUDGETS.md.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { BASH_AVAILABLE, readRepoText, repoPath } from '../../helpers/repo.js';

const SCRIPT = repoPath('scripts/preflight-credentials.sh');
const scriptOptions = { skip: !BASH_AVAILABLE, timeout: 30_000 };

// Values a leak would make visible: none of them may reach the output.
const REQUEST_TOKEN = 'gh-request-token-must-not-leak';
const OIDC_TOKEN = 'oidc-jwt-must-not-leak';
const ISSUED_TOKEN = 'registry-token-must-not-leak';
const CARGO_SECRET = 'cio-cargo-token-must-not-leak';

const PENDING_PUBLISHER_URL = 'https://pypi.org/manage/account/publishing/';

/**
 * One HTTP server standing in for GitHub's OIDC endpoint and all three
 * registries. `routes` maps "METHOD /path" to [status, body]; every request is
 * recorded so a test can check what the script sent.
 */
const stub = { routes: {}, requests: [], origin: '', server: null };

function respond(request, response) {
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    const [pathname] = request.url.split('?');
    const route = `${request.method} ${pathname}`;
    stub.requests.push({
      route,
      url: request.url,
      authorization: request.headers.authorization ?? '',
      userAgent: request.headers['user-agent'] ?? '',
      body,
    });
    const [status, payload] = stub.routes[route] ?? [418, { error: route }];
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(
      typeof payload === 'string' ? payload : JSON.stringify(payload)
    );
  });
}

/** A port nothing listens on: bound once, then released. */
async function closedPort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  probe.close();
  await once(probe, 'close');
  return port;
}

let workDir;

function environment(overrides) {
  return {
    ...process.env,
    ACTIONS_ID_TOKEN_REQUEST_URL: `${stub.origin}/oidc?api-version=2.0`,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: REQUEST_TOKEN,
    PYPI_API: `${stub.origin}/pypi`,
    NPM_REGISTRY: `${stub.origin}/npm`,
    CRATES_API: `${stub.origin}/crates`,
    NPM_PACKAGE: '@link-foundation/probe',
    CRATES_PACKAGE: 'probe-crate',
    CARGO_REGISTRY_TOKEN: '',
    CARGO_TOKEN: '',
    GITHUB_STEP_SUMMARY: '',
    PREFLIGHT_CURL_TIMEOUT: '5',
    PREFLIGHT_MODE: 'release',
    ...overrides,
  };
}

/**
 * Run the script asynchronously: the stub lives in this process, so a
 * synchronous spawn would block the event loop that has to answer it.
 */
async function preflight(overrides = {}, cwd = workDir) {
  const child = spawn('bash', [SCRIPT], { cwd, env: environment(overrides) });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const [status] = await once(child, 'close');
  return { status, output };
}

function assertNoSecrets(output) {
  for (const secret of [
    REQUEST_TOKEN,
    OIDC_TOKEN,
    ISSUED_TOKEN,
    CARGO_SECRET,
  ]) {
    assert.ok(!output.includes(secret), `output leaked ${secret}:\n${output}`);
  }
}

const OIDC_OK = [200, { value: OIDC_TOKEN }];
const MINT = 'POST /pypi/_/oidc/mint-token';
const EXCHANGE =
  'POST /npm/-/npm/v1/oidc/token/exchange/package/@link-foundation%2Fprobe';
const CRATES_MINT = 'POST /crates/api/v1/trusted_publishing/tokens';
const CRATES_REVOKE = 'DELETE /crates/api/v1/trusted_publishing/tokens';
const CRATES_PUBLISH = 'PUT /crates/api/v1/crates/new';
// What crates.io answers to an authorised publish that omits the archive.
const TOKEN_ACCEPTED = [
  400,
  { errors: [{ detail: 'invalid tarball length' }] },
];
const TOKEN_REJECTED = [403, { errors: [{ detail: 'authentication failed' }] }];
const INVALID_PUBLISHER = [
  422,
  {
    message: 'Token request failed',
    errors: [
      {
        code: 'invalid-publisher',
        description: 'valid token, but no corresponding publisher',
      },
    ],
  },
];

/** Run the PyPI probe against a mint-token endpoint answering `answer`. */
function probePypi(answer, overrides = {}) {
  stub.routes[MINT] = answer;
  return preflight({ PREFLIGHT_REGISTRIES: 'pypi', ...overrides });
}

function probeCrates(answer, overrides = {}) {
  stub.routes[CRATES_MINT] = answer;
  return preflight({ PREFLIGHT_REGISTRIES: 'crates', ...overrides });
}

/**
 * Refuse the crates.io OIDC exchange and answer the token publish probe with
 * `answer`, so the outcome rests on the token fallback.
 */
function probeFallback(answer, overrides = {}) {
  stub.routes[CRATES_PUBLISH] = answer;
  return probeCrates([403, {}], { CARGO_TOKEN: CARGO_SECRET, ...overrides });
}

/** Run the crates.io probe in a job without `id-token: write`. */
function preflightWithoutOidc(overrides = {}) {
  return preflight({
    PREFLIGHT_REGISTRIES: 'crates',
    ACTIONS_ID_TOKEN_REQUEST_URL: '',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: '',
    ...overrides,
  });
}

/** The metadata of a token publish probe: a u32 length, then JSON. */
function probeMetadata(body) {
  const bytes = Buffer.from(body, 'latin1');
  const length = bytes.readUInt32LE(0);
  assert.equal(bytes.length, 4 + length, 'the probe must carry no archive');
  return JSON.parse(bytes.subarray(4).toString('utf8'));
}

describe('scripts/preflight-credentials.sh', scriptOptions, () => {
  before(async () => {
    stub.server = createServer(respond);
    stub.server.listen(0, '127.0.0.1');
    await once(stub.server, 'listening');
    stub.origin = `http://127.0.0.1:${stub.server.address().port}`;
    workDir = mkdtempSync(path.join(tmpdir(), 'preflight-'));
  });

  after(async () => {
    stub.server.close();
    await once(stub.server, 'close');
    rmSync(workDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    stub.routes = { 'GET /oidc': OIDC_OK };
    stub.requests = [];
    rmSync(path.join(workDir, 'Cargo.toml'), { force: true });
    rmSync(path.join(workDir, 'package.json'), { force: true });
  });

  describe('PyPI trusted publishing', () => {
    it('passes when PyPI mints an upload token, without printing it', async () => {
      const { status, output } = await probePypi([
        200,
        { success: true, token: ISSUED_TOKEN },
      ]);

      assert.equal(status, 0, output);
      assert.match(output, /PASS: PyPI minted a short-lived upload token/);
      assert.match(output, /1 verified, 0 failed, 0 unknown/);
      assertNoSecrets(output);

      const [oidc, mint] = stub.requests;
      assert.equal(oidc.url, '/oidc?api-version=2.0&audience=pypi');
      assert.equal(oidc.authorization, `Bearer ${REQUEST_TOKEN}`);
      assert.deepEqual(JSON.parse(mint.body), { token: OIDC_TOKEN });
    });

    it('fails a release on invalid-publisher and points at the registration page', async () => {
      const { status, output } = await probePypi(INVALID_PUBLISHER);

      assert.equal(status, 1, output);
      assert.match(
        output,
        /::error::release-preflight: PyPI refused to mint an upload token \(422, invalid-publisher\)/
      );
      // Compared whole: a substring check on a URL is what CodeQL's
      // incomplete-url-substring-sanitization rule flags.
      const registration = output.match(/Register one \(.*?\) at (\S+);/);
      assert.equal(registration?.[1], PENDING_PUBLISHER_URL, output);
      assert.match(output, /explain_pypi_failure\.py/);
      assert.match(output, /refusing to release with 1 refused credential/);
      assertNoSecrets(output);
    });

    it('only warns about invalid-publisher in report mode', async () => {
      const { status, output } = await probePypi(INVALID_PUBLISHER, {
        PREFLIGHT_MODE: 'report',
      });

      assert.equal(status, 0, output);
      assert.match(output, /::warning::release-preflight: PyPI refused/);
      assert.doesNotMatch(output, /::error::/);
      assert.match(output, /Report mode: the failures above are advisory/);
    });

    it('reports an unreachable PyPI as unknown, which is not a release pass', async () => {
      const port = await closedPort();
      const env = {
        PREFLIGHT_REGISTRIES: 'pypi',
        PYPI_API: `http://127.0.0.1:${port}`,
      };

      const release = await preflight(env);
      assert.equal(release.status, 1, release.output);
      assert.match(
        release.output,
        /UNKNOWN: PyPI was unreachable during the mint-token probe/
      );
      assert.match(release.output, /0 verified, 0 failed, 1 unknown/);
      assert.match(
        release.output,
        /::error::release-preflight: verified nothing \(1 unknown\)/
      );

      const report = await preflight({ ...env, PREFLIGHT_MODE: 'report' });
      assert.equal(report.status, 0, report.output);
      assert.match(report.output, /Report mode: nothing was verified/);
      assert.doesNotMatch(report.output, /::error::/);
    });

    it('treats an unexpected PyPI answer as unknown, not as a refusal', async () => {
      const { status, output } = await probePypi([503, 'Service Unavailable']);

      assert.equal(status, 1, output);
      assert.match(output, /UNKNOWN: PyPI answered 503/);
      assert.match(output, /0 failed, 1 unknown/);
    });

    it('fails when the job has no OIDC token to exchange', async () => {
      const { status, output } = await preflight({
        PREFLIGHT_REGISTRIES: 'pypi',
        ACTIONS_ID_TOKEN_REQUEST_URL: '',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: '',
      });

      assert.equal(status, 1, output);
      assert.match(
        output,
        /::error::release-preflight: PyPI: no OIDC token available: .*id-token: write/
      );
      assert.equal(stub.requests.length, 0);
    });
  });

  describe('npm trusted publishing', () => {
    it('passes when npm exchanges the OIDC token for the package', async () => {
      stub.routes[EXCHANGE] = [201, { token: ISSUED_TOKEN }];

      const { status, output } = await preflight({
        PREFLIGHT_REGISTRIES: 'npm',
      });

      assert.equal(status, 0, output);
      assert.match(output, /PASS: npm exchanged the OIDC token/);
      assertNoSecrets(output);

      const [oidc, exchange] = stub.requests;
      assert.match(oidc.url, /&audience=npm%3A127\.0\.0\.1:\d+$/);
      assert.equal(exchange.route, EXCHANGE);
      assert.equal(exchange.authorization, `Bearer ${OIDC_TOKEN}`);
    });

    it('fails a release when npm refuses the exchange', async () => {
      stub.routes[EXCHANGE] = [404, { message: 'no trusted publisher' }];

      const { status, output } = await preflight({
        PREFLIGHT_REGISTRIES: 'npm',
      });

      assert.equal(status, 1, output);
      assert.match(
        output,
        /::error::release-preflight: npm refused the OIDC token exchange for @link-foundation\/probe \(404: no trusted publisher\)/
      );
    });

    it('reads the package name from package.json when NPM_PACKAGE is unset', async () => {
      writeFileSync(
        path.join(workDir, 'package.json'),
        '{\n  "name": "browser-commander",\n  "version": "1.0.0"\n}\n'
      );
      stub.routes[
        'POST /npm/-/npm/v1/oidc/token/exchange/package/browser-commander'
      ] = [200, { token: ISSUED_TOKEN }];

      const { status, output } = await preflight({
        PREFLIGHT_REGISTRIES: 'npm',
        NPM_PACKAGE: '',
      });

      assert.equal(status, 0, output);
      assert.match(output, /publish token for browser-commander/);
    });
  });

  describe('crates.io trusted publishing', () => {
    it('exchanges OIDC and revokes the temporary token without using a Cargo secret', async () => {
      stub.routes[CRATES_REVOKE] = [204, ''];

      const { status, output } = await probeCrates(
        [200, { token: ISSUED_TOKEN }],
        { CARGO_REGISTRY_TOKEN: CARGO_SECRET }
      );

      assert.equal(status, 0, output);
      assert.match(
        output,
        /PASS: crates.io minted a short-lived publish token/
      );
      const [oidc, mint, revoke] = stub.requests;
      assert.match(oidc.url, /&audience=127\.0\.0\.1:\d+\/crates$/);
      assert.deepEqual(JSON.parse(mint.body), { jwt: OIDC_TOKEN });
      assert.equal(mint.authorization, '');
      assert.equal(revoke.route, CRATES_REVOKE);
      assert.equal(revoke.authorization, `Bearer ${ISSUED_TOKEN}`);
      assert.equal(stub.requests.length, 3);
      assertNoSecrets(output);
    });

    it('fails a release when no trusted publisher matches and no token is set', async () => {
      const { status, output } = await probeCrates([
        403,
        { errors: [{ detail: 'no matching publisher' }] },
      ]);

      assert.equal(status, 1, output);
      assert.match(
        output,
        /::error::release-preflight: crates.io refused the OIDC token exchange \(403\)/
      );
      assert.match(output, /rust\.yml/);
      assert.match(output, /docs\/PUBLISHING\.md/);
      assert.match(output, /neither CARGO_REGISTRY_TOKEN nor CARGO_TOKEN/);
      assert.equal(stub.requests.length, 2);
    });

    it('passes a release on the token fallback when no trusted publisher matches', async () => {
      const { status, output } = await probeFallback(TOKEN_ACCEPTED);

      assert.equal(status, 0, output);
      assert.match(output, /1 verified, 0 failed, 0 unknown/);
      assert.match(
        output,
        /PASS: crates.io accepted the CARGO_REGISTRY_TOKEN\/CARGO_TOKEN fallback for probe-crate/
      );
      assert.match(
        output,
        /::warning::release-preflight: crates.io refused the OIDC token exchange \(403\).*falls back to the CARGO_REGISTRY_TOKEN\/CARGO_TOKEN secret/
      );
      assert.doesNotMatch(output, /::error::/);
      const publish = stub.requests.at(-1);
      assert.equal(publish.route, CRATES_PUBLISH);
      assert.equal(publish.authorization, CARGO_SECRET);
      assert.match(publish.userAgent, /^release-preflight /);
      assert.deepEqual(probeMetadata(publish.body), {
        name: 'probe-crate',
        vers: '0.0.0-preflight',
      });
      assert.equal(stub.requests.length, 3);
      assertNoSecrets(output);
    });

    it('prefers CARGO_REGISTRY_TOKEN over CARGO_TOKEN for the fallback', async () => {
      const { status, output } = await probeFallback(TOKEN_ACCEPTED, {
        CARGO_REGISTRY_TOKEN: CARGO_SECRET,
        CARGO_TOKEN: 'cio-other-token-must-not-be-used',
      });

      assert.equal(status, 0, output);
      assert.equal(stub.requests.at(-1).authorization, CARGO_SECRET);
    });

    it('fails a release when trusted publishing and the token fallback are both refused', async () => {
      const { status, output } = await probeFallback(TOKEN_REJECTED);

      assert.equal(status, 1, output);
      assert.match(output, /0 verified, 1 failed, 0 unknown/);
      assert.match(
        output,
        /::error::release-preflight: crates.io refused the OIDC token exchange \(403\).*; crates.io rejected the CARGO_REGISTRY_TOKEN\/CARGO_TOKEN fallback for probe-crate \(403\)/
      );
      assert.equal(stub.requests.length, 3);
      assertNoSecrets(output);
    });

    it('falls back to the token when the job has no OIDC permission', async () => {
      stub.routes[CRATES_PUBLISH] = TOKEN_ACCEPTED;
      const { status, output } = await preflightWithoutOidc({
        CARGO_REGISTRY_TOKEN: CARGO_SECRET,
      });

      assert.equal(status, 0, output);
      assert.match(
        output,
        /::warning::release-preflight: crates.io: no OIDC token available: .*id-token: write/
      );
      assert.deepEqual(
        stub.requests.map(({ route }) => route),
        [CRATES_PUBLISH]
      );
      assertNoSecrets(output);
    });

    it('fails when the job has no OIDC permission and no token is set', async () => {
      const { status, output } = await preflightWithoutOidc();

      assert.equal(status, 1, output);
      assert.match(
        output,
        /crates.io: no OIDC token available: .*id-token: write/
      );
      assert.equal(stub.requests.length, 0);
    });

    it('treats an unproven token fallback as unknown, never as a pass', async () => {
      for (const answer of [
        [400, { errors: [{ detail: 'invalid upload request' }] }],
        [429, {}],
        [500, { token: CARGO_SECRET }],
      ]) {
        const { status, output } = await probeFallback(answer);
        assert.equal(status, 1, output);
        assert.match(output, /0 verified, 0 failed, 1 unknown/);
        assert.match(output, /verified nothing/);
        assertNoSecrets(output);
      }
    });

    it('reads the crate name from Cargo.toml when CRATES_PACKAGE is unset', async () => {
      writeFileSync(
        path.join(workDir, 'Cargo.toml'),
        [
          '[package]',
          'name = "from-manifest"',
          'version = "1.2.3"',
          '',
          '[dependencies.serde]',
          'name = "not-this-one"',
          '',
        ].join('\n')
      );
      const { status, output } = await probeFallback(TOKEN_ACCEPTED, {
        CRATES_PACKAGE: '',
      });

      assert.equal(status, 0, output);
      assert.equal(
        probeMetadata(stub.requests.at(-1).body).name,
        'from-manifest'
      );
    });

    it('cannot probe the token without a crate name', async () => {
      const { status, output } = await probeFallback(TOKEN_ACCEPTED, {
        CRATES_PACKAGE: '',
      });

      assert.equal(status, 1, output);
      assert.match(output, /cannot tell which crate to probe/);
      assert.equal(stub.requests.length, 2);
    });

    it('keeps missing publishers advisory on pull requests', async () => {
      const { status, output } = await probeCrates([403, {}], {
        PREFLIGHT_MODE: 'report',
      });
      assert.equal(status, 0, output);
      assert.match(output, /::warning::release-preflight: crates.io refused/);
      assert.doesNotMatch(output, /::error::/);
    });

    it('treats missing tokens and unavailable registries as unknown', async () => {
      for (const answer of [
        [200, {}],
        [429, {}],
        [503, {}],
      ]) {
        const { status, output } = await probeCrates(answer);
        assert.equal(status, 1, output);
        assert.match(output, /0 verified, 0 failed, 1 unknown/);
        assert.equal(stub.requests.at(-1).route, CRATES_MINT);
        assertNoSecrets(output);
      }
      const port = await closedPort();
      const { status, output } = await preflight({
        PREFLIGHT_REGISTRIES: 'crates',
        CRATES_API: `http://127.0.0.1:${port}`,
      });
      assert.equal(status, 1, output);
      assert.match(output, /UNKNOWN: crates.io was unreachable/);
    });

    it('reports failed revocation without exposing the token', async () => {
      stub.routes[CRATES_REVOKE] = [403, { token: ISSUED_TOKEN }];
      const { status, output } = await probeCrates([
        200,
        { token: ISSUED_TOKEN },
      ]);
      assert.equal(status, 1, output);
      assert.match(output, /could not revoke the preflight token/);
      assertNoSecrets(output);
    });
  });

  describe('reporting', () => {
    it('reports every failure rather than stopping at the first', async () => {
      stub.routes[MINT] = INVALID_PUBLISHER;
      stub.routes[EXCHANGE] = [403, { message: 'forbidden' }];
      stub.routes[CRATES_MINT] = [401, { errors: [{ detail: 'bad token' }] }];
      stub.routes[CRATES_PUBLISH] = TOKEN_REJECTED;
      const summary = path.join(workDir, 'summary.md');
      writeFileSync(summary, '');

      const { status, output } = await preflight({
        PREFLIGHT_REGISTRIES: 'pypi,npm,crates',
        CARGO_REGISTRY_TOKEN: CARGO_SECRET,
        GITHUB_STEP_SUMMARY: summary,
      });

      assert.equal(status, 1, output);
      assert.match(output, /0 verified, 3 failed, 0 unknown/);
      assert.equal(output.match(/^::error::release-preflight: /gm).length, 4);
      assert.match(output, /refusing to release with 3 refused credential/);
      assertNoSecrets(output);

      const written = readFileSync(summary, 'utf8');
      assert.match(
        written,
        /### Release preflight \(release mode: pypi,npm,crates\)/
      );
      assert.match(written, /\| failed \| 3 \|/);
      assertNoSecrets(written);
    });

    it('refuses a release that names no registry or an unknown one', async () => {
      const empty = await preflight({ PREFLIGHT_REGISTRIES: '' });
      assert.equal(empty.status, 1, empty.output);
      assert.match(empty.output, /PREFLIGHT_REGISTRIES is empty/);

      const typo = await preflight({ PREFLIGHT_REGISTRIES: 'pipy' });
      assert.equal(typo.status, 1, typo.output);
      assert.match(typo.output, /unknown registry/);
    });
  });
});

/** Each job of a workflow, keyed by id, as the raw text of its block. */
function workflowJobs(file) {
  const text = readRepoText('.github', 'workflows', file);
  const body = text.slice(text.indexOf('\njobs:\n') + 1);
  const jobs = new Map();
  for (const chunk of body.split(/\n(?= {2}[\w-]+:\s*\n)/)) {
    const id = /^ {2}([\w-]+):\s*\n/.exec(chunk)?.[1];
    if (id) {
      jobs.set(id, chunk);
    }
  }
  return jobs;
}

/** A job's `needs:`, whether written inline or as a block list. */
function needsOf(job) {
  const inline = /^ {4}needs: *\[([^\]]*)\]/m.exec(job);
  if (inline) {
    return inline[1].split(',').map((need) => need.trim());
  }
  const list = /^ {4}needs: *\n((?: {6}- .*\n?)+)/m.exec(job);
  return list
    ? list[1].split('\n').map((line) => line.replace(/^ *- */, '').trim())
    : [];
}

const PREFLIGHT_WORKFLOWS = [
  {
    file: 'python.yml',
    registry: 'pypi',
    oidc: true,
    publishers: ['auto-release', 'manual-release'],
  },
  {
    file: 'js.yml',
    registry: 'npm',
    oidc: true,
    publishers: ['release', 'instant-release'],
  },
  {
    file: 'rust.yml',
    registry: 'crates',
    oidc: true,
    publishers: ['auto-release', 'manual-release'],
  },
];

describe('release-preflight in the language workflows', () => {
  for (const { file, registry, oidc, publishers } of PREFLIGHT_WORKFLOWS) {
    describe(file, () => {
      const jobs = workflowJobs(file);
      const preflightJob = jobs.get('release-preflight') ?? '';

      it(`has a release-preflight job probing ${registry}`, () => {
        assert.ok(preflightJob, `${file} has no release-preflight job`);
        assert.match(preflightJob, /^ {4}timeout-minutes: 5$/m);
        assert.match(preflightJob, /persist-credentials: false/);
        assert.match(
          preflightJob,
          new RegExp(`PREFLIGHT_REGISTRIES: ${registry}$`, 'm')
        );
        assert.match(preflightJob, /\) && 'release' \|\| 'report'/);
        assert.match(
          preflightJob,
          /run: bash \.\.\/scripts\/preflight-credentials\.sh/
        );
        assert.equal(/id-token: write/.test(preflightJob), oidc);
      });

      for (const publisher of publishers) {
        it(`gates ${publisher} on a successful preflight`, () => {
          const job = jobs.get(publisher) ?? '';
          assert.ok(job, `${file} has no ${publisher} job`);
          assert.ok(needsOf(job).includes('release-preflight'), job);
          assert.match(job, /needs\.release-preflight\.result == 'success'/);
        });
      }

      it('reports the preflight in pipeline-status', () => {
        assert.ok(
          needsOf(jobs.get('pipeline-status') ?? '').includes(
            'release-preflight'
          )
        );
      });
    });
  }
});
