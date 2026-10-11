import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {
  startTrace,
  readTrace,
  connectOrLaunch,
  connectBrowser,
} from '../../src/index.js';
import { isNavigationError } from '../../src/core/navigation-safety.js';
import { startProcess } from '../../src/utilities/subprocess.js';
import {
  closeOwnedSession,
  closeRemoteBrowser,
  SESSION_METADATA,
  probeSession,
} from '../../src/browser/persistent-session.js';
import {
  launchE2EBrowser,
  CHROME_LAUNCH_OPTIONS,
  PARITY_CHROME,
} from '../helpers/e2e-browser.js';
import { sendHtml, startFixtureHost } from '../helpers/fixture-server.js';

const options = { skip: !process.env.RUN_E2E, timeout: 60000 };
async function removeProfile(userDataDir) {
  await fs.rm(userDataDir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
async function port() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const number = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return number;
}
async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('browser condition did not settle');
}

for (const engine of ['playwright', 'puppeteer']) {
  it(
    `records bounded, private mutations and interrupted goto: ${engine}`,
    options,
    async () => {
      const output = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-160-e2e-'));
      const launched = await launchE2EBrowser({ engine });
      let trace;
      let slowStarted;
      const started = new Promise((resolve) => {
        slowStarted = resolve;
      });
      const server = await startFixtureHost((route, req, res) => {
        if (route === '/private') {
          res.setHeader('content-type', 'application/json');
          res.setHeader('X-Xsrftoken', 'PRIVATE_HEADER');
          res.end(
            JSON.stringify({ token: 'PRIVATE_RESPONSE', public: 'visible' })
          );
        } else if (route === '/slow') {
          slowStarted();
          req.once('close', () => res.destroy());
        } else {
          sendHtml(
            res,
            '<div id="app">public</div><input type="hidden" value="PRIVATE_HIDDEN"><meta name="csrf-token" content="PRIVATE_META"><script>window.xsrfToken="PRIVATE_SCRIPT";</script>'
          );
        }
      });
      try {
        await launched.page.goto(server.baseUrl);
        trace = await startTrace({
          page: launched.page,
          engine,
          output,
          mode: 'continuous',
          screenshots: false,
          network: { bodies: true, har: true },
          gzip: engine === 'puppeteer',
          privacy: { redactPatterns: [/PRIVATE_DYNAMIC/g] },
          links: { dom: 'full', output: path.join(output, 'trace.lino') },
        });
        await launched.page.evaluate(async () => {
          await fetch('/private?xsrf=PRIVATE_QUERY', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'X-Xsrftoken': 'PRIVATE_HEADER',
            },
            body: JSON.stringify({
              password: 'PRIVATE_PASSWORD',
              _xsrf: 'PRIVATE_BODY',
              public: 'visible',
            }),
          }).then((response) => response.text());
        });
        await launched.page.evaluate(() => {
          const app = document.querySelector('#app');
          app.innerHTML = `<section>${'public'.repeat(1000)}</section>`;
          for (let i = 0; i < 50; i++) {
            const node = document.createElement('span');
            node.textContent = `public-${i} PRIVATE_DYNAMIC`;
            app.appendChild(node);
          }
          document.querySelector('meta').content = 'PRIVATE_CHANGED';
        });
        await trace.checkpoint('after');
        await trace.stop();
        const opened = await readTrace(output);
        const batches = await opened.mutations(opened.checkpoints[0].index);
        const data = JSON.stringify(batches);
        assert.ok(data.length < 60000, `mutation bytes: ${data.length}`);
        for (const batch of batches) {
          for (const record of batch.records ?? []) {
            assert.equal(record.target?.html, undefined);
          }
        }
        const contents = [
          data,
          JSON.stringify(opened.events),
          await fs.readFile(path.join(output, 'trace.lino'), 'utf8'),
          await fs.readFile(path.join(output, 'network.har'), 'utf8'),
          ...(await Promise.all(
            opened.checkpoints.map((cp) => opened.html(cp.index))
          )),
        ];
        for (const text of contents) {
          assert.doesNotMatch(text, /PRIVATE_/);
          assert.match(text, /public|visible/);
        }
        const interrupted = launched.page
          .goto(`${server.baseUrl}/slow`)
          .catch((error) => error);
        await started;
        await launched.page.goto(server.baseUrl);
        assert.equal(isNavigationError(await interrupted), true);
      } finally {
        await trace?.stop();
        await launched.cleanup();
        await server.close();
        await fs.rm(output, { recursive: true, force: true });
      }
    }
  );
}

it(
  'adopts a verified profile, heartbeats an idle controller and closes later tabs',
  options,
  async () => {
    const userDataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'bc-160-session-')
    );
    const remoteDebuggingPort = await port();
    const settings = {
      engine: 'playwright',
      userDataDir,
      remoteDebuggingPort,
      idleTimeoutMs: 2500,
      headless: true,
      ...CHROME_LAUNCH_OPTIONS,
    };
    let session, originalOwner;
    try {
      session = await connectOrLaunch(settings);
      originalOwner = JSON.parse(
        await fs.readFile(path.join(userDataDir, SESSION_METADATA), 'utf8')
      );
      await session.detach();
      await fs.rm(path.join(userDataDir, SESSION_METADATA));
      session = await connectOrLaunch({
        ...settings,
        adoptExisting: true,
        closeNewTabs: true,
      });
      assert.equal(session.adopted, true);
      const selected = session.page;
      await session.browser
        .contexts()[0]
        .newPage()
        .catch(() => {});
      await until(() => session.browser.contexts()[0].pages().length === 1);
      assert.equal(session.page, selected);
      await selected.close();
      const replacement = await session.reusePage();
      assert.equal(replacement.isClosed(), false);
      await new Promise((resolve) => setTimeout(resolve, 4000));
      assert.ok(await probeSession(`http://127.0.0.1:${remoteDebuggingPort}`));
      await session.detach();
      await closeOwnedSession(
        path.join(userDataDir, SESSION_METADATA),
        JSON.parse(
          await fs.readFile(path.join(userDataDir, SESSION_METADATA), 'utf8')
        )
      );
    } finally {
      await session?.detach();
      const metadataFile = path.join(userDataDir, SESSION_METADATA);
      const metadata = await fs
        .readFile(metadataFile, 'utf8')
        .then(JSON.parse, () => null);
      if (metadata) {
        await closeOwnedSession(metadataFile, metadata);
      } else if (originalOwner) {
        const version = await probeSession(
          `http://127.0.0.1:${remoteDebuggingPort}`
        );
        if (
          version?.webSocketDebuggerUrl === originalOwner.webSocketDebuggerUrl
        ) {
          await closeRemoteBrowser(version.webSocketDebuggerUrl);
        }
      }
      await removeProfile(userDataDir);
    }
  }
);

it(
  'reconnects to headed Chrome with no page targets in its default context',
  options,
  async () => {
    const userDataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'bc-160-zero-pages-')
    );
    const remoteDebuggingPort = await port();
    const endpoint = `http://127.0.0.1:${remoteDebuggingPort}`;
    const process = startProcess(PARITY_CHROME, [
      ...(CHROME_LAUNCH_OPTIONS.args ?? []),
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${remoteDebuggingPort}`,
      '--no-startup-window',
      '--keep-alive-for-test',
      '--no-first-run',
    ]);
    let connection;
    try {
      await until(() => probeSession(endpoint));
      const targets = await fetch(`${endpoint}/json/list`).then((response) =>
        response.json()
      );
      assert.equal(
        targets.filter((target) => target.type === 'page').length,
        0
      );
      connection = await connectBrowser({
        engine: 'playwright',
        cdpEndpoint: endpoint,
      });
      assert.ok(connection.page);
      await connection.page.goto('data:text/html,<p>public profile page</p>');
      await connection.detach();
      assert.ok(await probeSession(endpoint));
    } finally {
      await connection?.detach();
      process.kill();
      await process.exited;
      await removeProfile(userDataDir);
    }
  }
);
