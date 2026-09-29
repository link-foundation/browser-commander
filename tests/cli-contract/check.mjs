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
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
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
    const parsed = JSON.parse(await response);
    assert.equal(parsed.id, id, `${language.name}/${engine}: ${stderr}`);
    assert.ok(
      !parsed.error,
      `${language.name}/${engine}: ${JSON.stringify(parsed.error)}`
    );
    return parsed.result;
  }

  try {
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
    const { page } = await call('handle.root', { name: `session:${session}` });
    const described = await call('handle.describe', { handle: page });
    assert.ok(described.methods.includes('locator'));
    const locator = await call('handle.call', {
      handle: page,
      method: 'locator',
      args: ['#name'],
    });
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
    const code = await completion;
    assert.equal(code, 0, `${language.name}/${engine}: ${stderr}`);
  }
}

for (const language of languages) {
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

  for (const engine of ['playwright', 'puppeteer']) {
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
