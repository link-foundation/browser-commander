/**
 * Coverage of the typed Rust Playwright bindings against `protocol.yml`
 * (issue #108).
 *
 * The Rust `playwright` engine talks to the official driver through
 * `rust/src/playwright/protocol/`, generated from the vendored protocol spec in
 * `rust/protocol/playwright/`. These tests read the spec on their own and fail
 * when:
 *
 * - the committed bindings differ from what the generator writes;
 * - any interface, command (own or inherited) or event in the spec has no typed
 *   Rust counterpart;
 * - the vendored spec disagrees with the driver that is installed, which is
 *   the one the Rust tests and CI start.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import { repoPath } from '../helpers/repo.js';

const SPEC_DIR = repoPath('rust/protocol/playwright');
const OUT_DIR = repoPath('rust/src/playwright/protocol');

const { generateProtocol } = await import(
  pathToFileURL(repoPath('scripts/generate-playwright-protocol.mjs'))
);

const require = createRequire(repoPath('js/package.json'));
const YAML = require('yaml');

function loadDefinitions() {
  const definitions = {};
  for (const file of fs
    .readdirSync(SPEC_DIR)
    .filter((f) => f.endsWith('.yml'))) {
    const parsed = YAML.parse(
      fs.readFileSync(path.join(SPEC_DIR, file), 'utf8')
    );
    Object.assign(definitions, parsed ?? {});
  }
  return definitions;
}

const definitions = loadDefinitions();
const version = fs.readFileSync(path.join(SPEC_DIR, 'VERSION'), 'utf8').trim();
const interfaces = Object.keys(definitions).filter(
  (name) => definitions[name].type === 'interface'
);

/** `goto` -> `Goto`, `setViewportSize` -> `SetViewportSize`. */
function upperFirst(name) {
  return name[0].toUpperCase() + name.slice(1);
}

/** Own and inherited members, with the interface that declares each one. */
function members(name, kind) {
  const definition = definitions[name];
  const inherited = definition.extends ? members(definition.extends, kind) : [];
  const own = Object.entries(definition[kind] ?? {}).map(([member, spec]) => ({
    owner: name,
    name: member,
    spec: spec ?? {},
  }));
  const ownNames = new Set(own.map((member) => member.name));
  return [...inherited.filter((m) => !ownNames.has(m.name)), ...own];
}

function hasEntries(value) {
  return Boolean(value) && Object.keys(value).length > 0;
}

/**
 * Every top-level `impl … {` block in the generated sources keyed by its
 * header (`impl Page`, `impl ChannelType for Page`), and every struct or enum
 * body keyed by `struct Name` or `enum Name`.
 */
function rustBlocks() {
  const blocks = new Map();
  for (const file of fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.rs'))) {
    const source = fs.readFileSync(path.join(OUT_DIR, file), 'utf8');
    for (const match of source.matchAll(
      /^(impl [^\n{]+?|pub (?:struct|enum) \w+) \{(?:\}|\n([\s\S]*?)^\})/gmu
    )) {
      const key = match[1].replace(/^pub /u, '');
      blocks.set(key, `${blocks.get(key) ?? ''}${match[2] ?? ''}`);
    }
  }
  return blocks;
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

describe('Rust Playwright protocol bindings', () => {
  it('are what the generator writes from the vendored spec', () => {
    const files = generateProtocol();
    const committed = fs
      .readdirSync(OUT_DIR)
      .filter((file) => file.endsWith('.rs'))
      .sort();
    assert.deepEqual(committed, [...files.keys()].sort());
    for (const [file, contents] of files) {
      assert.equal(
        fs.readFileSync(path.join(OUT_DIR, file), 'utf8'),
        contents,
        `${file} is stale; run node scripts/generate-playwright-protocol.mjs`
      );
    }
  });

  it('pin the spec version they were generated from', () => {
    const module = fs.readFileSync(path.join(OUT_DIR, 'mod.rs'), 'utf8');
    assert.match(
      module,
      new RegExp(
        `pub const PROTOCOL_VERSION: &str = "${escape(version)}";`,
        'u'
      )
    );
  });

  it('cover every interface, command and event in protocol.yml', () => {
    const blocks = rustBlocks();
    const missing = [];
    let commands = 0;
    let events = 0;
    assert.ok(interfaces.length >= 30, `only ${interfaces.length} interfaces`);
    for (const name of interfaces) {
      const channel = blocks.get(`impl ChannelType for ${name}`) ?? '';
      if (!channel.includes(`const INTERFACE: &'static str = "${name}";`)) {
        missing.push(`${name}: channel type`);
      }
      if (!blocks.has(`struct ${name}Initializer`)) {
        missing.push(`${name}: initializer`);
      }

      const methods = blocks.get(`impl ${name}`) ?? '';
      for (const command of members(name, 'commands')) {
        commands += 1;
        const base = `${command.owner}${upperFirst(command.name)}`;
        const params = hasEntries(command.spec.parameters)
          ? `, params: ${base}Params\\)`
          : '\\)';
        const result = hasEntries(command.spec.returns)
          ? `${base}Result`
          : '\\(\\)';
        const send = hasEntries(command.spec.returns)
          ? 'send'
          : 'send_no_result';
        const method = new RegExp(
          `/// \`${escape(command.owner)}\\.${escape(command.name)}\`[^\\n]*\\n` +
            `\\s*pub async fn (?:r#)?\\w+\\(&self${params} -> Result<${result}, ProtocolError> \\{\\n` +
            `\\s*self\\.channel\\.${send}\\("${escape(command.name)}", `,
          'u'
        );
        if (!method.test(methods)) {
          missing.push(`${name}.${command.name}`);
        }
      }

      const variants = blocks.get(`enum ${name}Event`) ?? '';
      const parse = blocks.get(`impl ProtocolEvent for ${name}Event`) ?? '';
      for (const event of members(name, 'events')) {
        events += 1;
        const variant = upperFirst(event.name);
        const declared = hasEntries(event.spec.parameters)
          ? `${variant}(${event.owner}${variant}EventParams),`
          : `${variant},`;
        if (
          !variants.includes(
            `/// \`${event.owner}.${event.name}\`\n    ${declared}`
          ) ||
          !parse.includes(`"${event.name}" => Ok(Self::${variant}`)
        ) {
          missing.push(`${name} event ${event.name}`);
        }
      }
    }
    assert.deepEqual(missing, []);
    assert.ok(commands > 300, `only ${commands} commands`);
    assert.ok(events > 50, `only ${events} events`);
  });

  it('match the protocol of the installed driver', (t) => {
    let root;
    try {
      root = path.dirname(require.resolve('playwright-core/package.json'));
    } catch {
      t.skip('playwright-core is not installed');
      return;
    }
    const installed = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8')
    ).version;
    if (installed !== version) {
      t.skip(
        `playwright-core ${installed} is installed, the spec is ${version}`
      );
      return;
    }
    // The driver validates every message against these schemes; one exists per
    // command (`<Interface><Command>Params`) and event (`<Interface><Event>Event`).
    const bundle = fs.readFileSync(
      path.join(root, 'lib/coreBundle.js'),
      'utf8'
    );
    const driver = new Set(
      [...bundle.matchAll(/scheme\.(\w+(?:Params|Event)) = /gu)]
        .map((match) => match[1])
        .filter((scheme) => !definitions[scheme])
    );
    const spec = new Set();
    for (const name of interfaces) {
      for (const command of members(name, 'commands')) {
        spec.add(`${name}${upperFirst(command.name)}Params`);
      }
      for (const event of members(name, 'events')) {
        spec.add(`${name}${upperFirst(event.name)}Event`);
      }
    }
    assert.ok(driver.size > 300, `found ${driver.size} driver schemes`);
    assert.deepEqual([...spec].filter((s) => !driver.has(s)).sort(), []);
    assert.deepEqual([...driver].filter((s) => !spec.has(s)).sort(), []);
  });
});
