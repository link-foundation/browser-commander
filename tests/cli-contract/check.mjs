#!/usr/bin/env node
/** Exercise the same real-browser command script through all three CLIs. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { normalizeRunOutput } from './normalize.mjs';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const script = path.join(root, 'tests/cli-contract/basic.json');
const expected = JSON.parse(
  readFileSync(path.join(root, 'tests/cli-contract/basic.expected.json'))
);
const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const python = process.env.BROWSER_COMMANDER_PYTHON || 'python';
const rust =
  process.env.BROWSER_COMMANDER_RUST ||
  path.join(root, 'rust/target/debug/browser-commander');
const env = {
  ...process.env,
  PYTHONPATH: path.join(root, 'python/src'),
};

const languages = [
  {
    name: 'javascript',
    file: process.execPath,
    args: [path.join(root, 'js/bin/browser-commander.js')],
  },
  { name: 'python', file: python, args: ['-m', 'browser_commander.cli'] },
  { name: 'rust', file: rust, args: [] },
];

function command(language, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(language.file, [...language.args, ...args], {
      cwd: root,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const deadline = setTimeout(() => {
      stderr += '\nCLI command exceeded its 120 second test budget';
      child.kill('SIGKILL');
    }, 120000);
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(deadline);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

async function genericHandleContract(language, engine) {
  const child = spawn(language.file, [...language.args, 'serve', '--stdio'], {
    cwd: root,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const lines = createInterface({ input: child.stdout });
  const replies = [];
  let nextReply;
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr += chunk;
  });
  lines.on('line', (line) => {
    if (nextReply) {
      const resolve = nextReply;
      nextReply = undefined;
      resolve(line);
    } else {
      replies.push(line);
    }
  });

  let id = 0;
  async function call(method, params = {}) {
    const response = new Promise((resolve) => {
      nextReply = resolve;
      if (replies.length) {
        nextReply = undefined;
        resolve(replies.shift());
      }
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })}\n`
    );
    let deadline;
    const timedOut = new Promise((_, reject) => {
      deadline = setTimeout(() => {
        reject(
          new Error(
            `${language.name}/${engine}: ${method} timed out\n${stderr}`
          )
        );
      }, 60000);
    });
    let parsed;
    try {
      parsed = JSON.parse(
        await Promise.race([
          response,
          timedOut,
          completion.then((code) => {
            throw new Error(
              `${language.name}/${engine}: CLI exited (${code}) before ${method}\n${stderr}`
            );
          }),
        ])
      );
    } finally {
      clearTimeout(deadline);
    }
    assert.equal(parsed.id, id, `${language.name}/${engine}: ${stderr}`);
    assert.ok(
      !parsed.error,
      `${language.name}/${engine}: ${JSON.stringify(parsed.error)}`
    );
    return parsed.result;
  }

  try {
    if (engine === 'selenium') {
      const module = await call('handle.root', { name: engine });
      const builder = await call('handle.get', {
        handle: module,
        property: 'Builder',
      });
      const instance = await call('handle.construct', { handle: builder });
      const description = await call('handle.describe', { handle: instance });
      assert.equal(description.type, 'Builder');
      assert.ok(description.methods.includes('build'));
    }
    const { session } = await call('session.launch', {
      engine,
      headless: true,
      executablePath: chrome,
      ...(process.env.CHROME_NO_SANDBOX === 'true'
        ? { args: ['--no-sandbox'] }
        : {}),
    });
    await call('page.goto', {
      session,
      url: 'data:text/html,<input id="name">',
    });
    const { page, driver } = await call('handle.root', {
      name: `session:${session}`,
    });
    const described = await call('handle.describe', { handle: page });
    assert.ok(
      described.methods.includes(
        engine === 'selenium' ? 'waitForSelector' : 'locator'
      )
    );
    const locator = await call(
      'handle.call',
      engine === 'selenium'
        ? {
            handle: driver,
            method: 'findElement',
            args: [{ css: '#name' }],
          }
        : {
            handle: page,
            method: 'locator',
            args: ['#name'],
          }
    );
    const locatorMethods = await call('handle.describe', { handle: locator });
    assert.ok(locatorMethods.methods.includes('click'));
    await call('handle.call', { handle: locator, method: 'click' });
    assert.deepEqual(
      await call('page.eval', {
        session,
        expression: 'document.activeElement.id',
      }),
      { value: 'name' }
    );
    await call('session.close', { session });
  } finally {
    child.stdin.end();
    const deadline = setTimeout(() => child.kill('SIGKILL'), 60000);
    try {
      const code = await completion;
      assert.equal(code, 0, `${language.name}/${engine}: ${stderr}`);
    } finally {
      clearTimeout(deadline);
      lines.close();
    }
  }
}

const selected = process.env.BROWSER_COMMANDER_LANGUAGES?.split(',');
for (const language of languages.filter(
  (entry) => !selected || selected.includes(entry.name)
)) {
  const version = await command(language, ['version']);
  assert.equal(version.code, 0, `${language.name}: ${version.stderr}`);
  assert.equal(
    JSON.parse(version.stdout).language,
    language.name === 'javascript' ? 'js' : language.name
  );

  const rpc = await command(
    language,
    ['serve', '--stdio'],
    `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'version' })}\n`
  );
  assert.equal(rpc.code, 0, `${language.name}: ${rpc.stderr}`);
  const response = JSON.parse(rpc.stdout.trim());
  assert.equal(response.id, 1);
  assert.equal(response.result.name, 'browser-commander');

  for (const engine of ['playwright', 'puppeteer', 'selenium']) {
    const browserArgs = [
      'run',
      script,
      '--engine',
      engine,
      '--executable-path',
      chrome,
      ...(process.env.CHROME_NO_SANDBOX === 'true'
        ? ['--arg=--no-sandbox']
        : []),
    ];
    const run = await command(language, browserArgs);
    assert.equal(
      run.code,
      0,
      `${language.name}/${engine}: ${run.stderr}\n${run.stdout}`
    );
    assert.deepEqual(
      normalizeRunOutput(JSON.parse(run.stdout)),
      expected,
      `${language.name}/${engine}`
    );
    await genericHandleContract(language, engine);
    process.stdout.write(`${language.name}/${engine}: contract passed\n`);
  }
}
