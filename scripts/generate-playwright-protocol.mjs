// Generate every typed command, initializer and event from the pinned official
// protocol.yml (split into spec/*.yml by Playwright 1.63). Unknown schema shapes
// fail generation rather than quietly turning parameters into untyped JSON.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runCommand } from '../js/src/utilities/subprocess.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const yaml = createRequire(new URL('../js/package.json', import.meta.url))(
  'yaml'
);
const source = path.join(root, 'shared/upstream/playwright/1.63.0');
const target = path.join(root, 'rust/src/browser/playwright_driver/generated');
const header =
  '// Generated from Playwright 1.63.0 protocol YAML. Do not edit.\n';
const definitions = {};
const provenance = JSON.parse(
  await fs.readFile(path.join(source, 'source.json'), 'utf8')
);
const sourceFiles = (await fs.readdir(source))
  .filter((name) => name.endsWith('.yml'))
  .sort();
if (
  JSON.stringify(sourceFiles) !==
  JSON.stringify(provenance.files.map((file) => path.basename(file)).sort())
)
  throw new Error('Pinned Playwright source file inventory differs');
for (const name of sourceFiles) {
  const contents = await fs.readFile(path.join(source, name), 'utf8');
  if (
    createHash('sha256').update(contents).digest('hex') !==
    provenance.sha256[name]
  )
    throw new Error(`Pinned Playwright source differs: ${name}`);
  const parsed = yaml.parse(contents);
  for (const [key, value] of Object.entries(parsed)) {
    if (definitions[key])
      throw new Error(`Duplicate protocol definition ${key}`);
    definitions[key] = value;
  }
}

function snake(name) {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .toLowerCase();
}
function pascal(name) {
  const value = name
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .split('_')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
  return /^\d/.test(value) ? `Value${value}` : value;
}
function field(name) {
  const value = snake(name);
  return [
    'type',
    'ref',
    'match',
    'loop',
    'in',
    'move',
    'async',
    'await',
    'return',
    'where',
    'use',
    'mod',
    'self',
    'super',
    'crate',
    'fn',
    'impl',
    'struct',
    'enum',
    'const',
    'static',
    'pub',
    'dyn',
    'as',
    'for',
    'let',
    'mut',
    'box',
    'abstract',
    'virtual',
    'try',
    'yield',
    'priv',
    'final',
    'override',
    'unsized',
    'become',
    'do',
    'macro',
    'union',
    'gen',
    'continue',
    'break',
    'else',
    'if',
    'false',
    'true',
    'trait',
    'while',
    'unsafe',
    'extern',
    'fn',
  ].includes(value)
    ? `r#${value}`
    : value;
}
function properties(input = {}, seen = new Set()) {
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (key.startsWith('$mixin')) {
      if (seen.has(value) || definitions[value]?.type !== 'mixin')
        throw new Error(`Invalid/cyclic mixin ${value}`);
      Object.assign(
        output,
        properties(definitions[value].properties, new Set([...seen, value]))
      );
    } else output[key] = value;
  }
  return output;
}
const files = new Map();
function renderTypes(baseName, schema) {
  const items = [];
  const names = new Set();
  function type(input, name) {
    const value = typeof input === 'string' ? { type: input } : input;
    if (!value || typeof value.type !== 'string')
      throw new Error(`Missing type at ${name}`);
    const optional = value.type.endsWith('?');
    const kind = value.type.replace(/\?$/, '');
    let result;
    switch (kind) {
      case 'string':
      case 'binary':
        result = 'String';
        break;
      case 'int':
        result = 'i64';
        break;
      case 'float':
        result = 'f64';
        break;
      case 'boolean':
        result = 'bool';
        break;
      case 'json':
      case 'any':
        result = 'serde_json::Value';
        break;
      case 'Channel':
        result = 'super::super::ChannelRef<super::super::AnyChannel>';
        break;
      case 'array':
        result = `Vec<${type(value.items, `${name}Item`)}>`;
        break;
      case 'enum': {
        const variants = new Set();
        const lines = value.literals.map((literal) => {
          let variant = pascal(String(literal));
          if (variants.has(variant)) variant = `Negative${variant}`;
          if (variants.has(variant))
            throw new Error(`Duplicate enum variant ${name}.${literal}`);
          variants.add(variant);
          return `#[serde(rename = ${JSON.stringify(String(literal))})]\n${variant},`;
        });
        items.push(
          `#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]\npub enum ${name} {\n${lines.join('\n')}\n}\n`
        );
        names.add(name);
        result = name;
        break;
      }
      case 'object': {
        const fields = Object.entries(properties(value.properties)).map(
          ([key, val]) => {
            const ty = type(val, `${name}${pascal(key)}`);
            const attr = ty.startsWith('Option<')
              ? '#[serde(default, skip_serializing_if = "Option::is_none")]\n'
              : '';
            return `#[serde(rename = ${JSON.stringify(key)})]\n${attr}pub ${field(key)}: ${ty},`;
          }
        );
        items.push(
          `#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]\npub struct ${name} {\n${fields.join('\n')}\n}\n`
        );
        names.add(name);
        result = name;
        break;
      }
      default: {
        const definition = definitions[kind];
        if (!definition)
          throw new Error(`Unknown schema type ${kind} at ${name}`);
        const reference = `super::super::types::${kind}`;
        result =
          definition.type === 'interface'
            ? `super::super::ChannelRef<${reference}>`
            : `Box<${reference}>`;
      }
    }
    return optional ? `Option<${result}>` : result;
  }
  type(schema, baseName);
  return { body: items.join('\n'), names };
}
const manifest = {
  version: '1.63.0',
  commands: [],
  initializers: [],
  events: [],
};
const globalModules = [];
const interfaces = [];
for (const [name, definition] of Object.entries(definitions).sort(([a], [b]) =>
  a.localeCompare(b)
)) {
  const module = snake(name);
  if (definition.type === 'interface') {
    interfaces.push(name);
    globalModules.push(`#[derive(Clone, Debug, Default)]\npub struct ${name};`);
  } else {
    const schema =
      definition.type === 'mixin'
        ? { ...definition, type: 'object' }
        : definition;
    const generated = renderTypes(name, schema);
    files.set(`types/${module}.rs`, header + generated.body);
    globalModules.push(`mod ${module};\npub use ${module}::*;`);
  }
}
files.set('types/mod.rs', header + globalModules.join('\n'));
const channelModules = [];
for (const name of interfaces) {
  const definition = definitions[name];
  const module = snake(name);
  const parts = [];
  const methods = [];
  function record(key, schema) {
    const moduleName = snake(key);
    const typeName = pascal(key);
    const generated = renderTypes(typeName, {
      type: 'object',
      properties: schema || {},
    });
    files.set(`${module}/${moduleName}.rs`, header + generated.body);
    parts.push(`pub mod ${moduleName};`);
    return {
      moduleName,
      typeName,
      fields: Object.keys(properties(schema)).sort(),
    };
  }
  const initializer = record('Initializer', definition.initializer);
  manifest.initializers.push({ interface: name, fields: initializer.fields });
  for (const [event, schema] of Object.entries(definition.events || {})) {
    const eventType = record(`${pascal(event)}Event`, schema?.parameters);
    manifest.events.push({ interface: name, event, fields: eventType.fields });
  }
  for (const [command, specValue] of Object.entries(
    definition.commands || {}
  )) {
    const spec = specValue || {};
    const parameters = record(`${pascal(command)}Params`, spec.parameters);
    const result = record(`${pascal(command)}Result`, spec.returns);
    const paramsPath = `${parameters.moduleName}::${parameters.typeName}`;
    const resultPath = `${result.moduleName}::${result.typeName}`;
    methods.push(
      `pub async fn ${field(command)}(&self, params: ${paramsPath}) -> playwright_rs::Result<${resultPath}> { self.0.call(${JSON.stringify(command)}, params).await }`
    );
    manifest.commands.push({
      interface: name,
      command,
      parameters: parameters.fields,
      returns: result.fields,
    });
  }
  // Inherited methods remain typed by rebinding the same GUID to its base.
  const inheritance = definition.extends
    ? `pub fn as_${snake(definition.extends)}(&self) -> super::${snake(definition.extends)}::${definition.extends}Channel { super::${snake(definition.extends)}::${definition.extends}Channel::new(self.0.connection(), self.0.reference().guid.clone()) }`
    : '';
  for (let index = 0; index < methods.length; index += 20) {
    const part = `methods_${index / 20}`;
    parts.push(`mod ${part};`);
    files.set(
      `${module}/${part}.rs`,
      header +
        `use super::*;\nimpl ${name}Channel {\n${methods.slice(index, index + 20).join('\n')}\n}\n`
    );
  }
  files.set(
    `${module}/mod.rs`,
    header +
      `use super::super::Channel;\n${parts.join('\n')}\n#[derive(Clone)]\npub struct ${name}Channel(pub Channel<super::types::${name}>);\nimpl ${name}Channel {\npub fn new(connection: std::sync::Arc<playwright_rs::server::connection::Connection>, guid: impl Into<String>) -> Self { Self(Channel::new(connection,guid.into())) }\npub fn reference(&self) -> super::super::ChannelRef<super::types::${name}> { self.0.reference() }\n${inheritance}\n}\n`
  );
  channelModules.push(`pub mod ${module};`);
}
files.set(
  'mod.rs',
  header +
    `pub use super::{AnyChannel, ChannelRef};\npub mod types;\n${channelModules.join('\n')}\npub const PROTOCOL_VERSION: &str = "1.63.0";\npub const COMMAND_COUNT: usize = ${manifest.commands.length};\n`
);
files.set(
  'coverage.json',
  '{\n' +
    Object.entries(manifest)
      .map(
        ([key, value]) =>
          `${JSON.stringify(key)}:${Array.isArray(value) ? '[\n' + value.map((item) => JSON.stringify(item)).join(',\n') + '\n]' : JSON.stringify(value)}`
      )
      .join(',\n') +
    '\n}\n'
);

const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), 'browser-commander-protocol-')
);
files.set('LICENSE', await fs.readFile(path.join(source, 'LICENSE'), 'utf8'));
try {
  for (const [name, body] of files) {
    await fs.mkdir(path.dirname(path.join(temporary, name)), {
      recursive: true,
    });
    await fs.writeFile(path.join(temporary, name), body);
  }
  // Format the module tree once; rustfmt follows its declared submodules.
  await runCommand('rustfmt', [
    '--edition',
    '2021',
    path.join(temporary, 'mod.rs'),
  ]);
  if (process.argv.includes('--check')) {
    const actualFiles = (
      await fs.readdir(target, { recursive: true, withFileTypes: true })
    )
      .filter((entry) => entry.isFile())
      .map((entry) =>
        path
          .relative(target, path.join(entry.parentPath, entry.name))
          .split(path.sep)
          .join('/')
      )
      .sort();
    if (
      JSON.stringify(actualFiles) !== JSON.stringify([...files.keys()].sort())
    )
      throw new Error('Generated Playwright file inventory differs');
    for (const name of files.keys()) {
      const expected = await fs.readFile(path.join(temporary, name), 'utf8');
      const actual = await fs
        .readFile(path.join(target, name), 'utf8')
        .catch(() => null);
      if (expected !== actual)
        throw new Error(`Stale generated Playwright binding: ${name}`);
    }
    console.log(
      `Covered ${manifest.commands.length} typed commands, ${manifest.events.length} events and ${manifest.initializers.length} initializers`
    );
  } else {
    await fs.rm(target, { recursive: true, force: true });
    await fs.cp(temporary, target, { recursive: true });
    console.log(
      `Generated ${manifest.commands.length} typed official driver commands`
    );
  }
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
