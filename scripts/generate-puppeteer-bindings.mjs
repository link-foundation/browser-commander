#!/usr/bin/env node
/**
 * Generate typed Rust and Python wrappers of Puppeteer's API (issue #108).
 *
 * The API manifest `rust/protocol/puppeteer/api.json` is extracted from the
 * `.d.ts` file that puppeteer-core ships (see scripts/puppeteer-api.mjs). From
 * it this script writes one wrapper per Puppeteer class or interface:
 *
 * - `rust/src/puppeteer/api/*.rs`: a struct around a remote handle with one
 *   `async fn` per method or getter, own and inherited;
 * - `python/src/browser_commander/puppeteer/api/*.py`: a class per type that
 *   extends the class its Puppeteer type extends, with one `async def` per own
 *   method or getter.
 *
 * Every wrapper is a typed `handle.call` (or `handle.get`) over the generic
 * `browser-commander serve --stdio` bridge, so every Puppeteer method has a
 * typed entry point in both languages.
 *
 * Usage:
 *   node scripts/generate-puppeteer-bindings.mjs              # write bindings
 *   node scripts/generate-puppeteer-bindings.mjs --check      # fail if stale
 *   node scripts/generate-puppeteer-bindings.mjs --update-api # re-extract the
 *     manifest from the installed puppeteer-core first
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_PATH = path.join(
  ROOT,
  'rust',
  'protocol',
  'puppeteer',
  'api.json'
);
export const RUST_DIR = path.join(ROOT, 'rust', 'src', 'puppeteer', 'api');
export const PYTHON_DIR = path.join(
  ROOT,
  'python',
  'src',
  'browser_commander',
  'puppeteer',
  'api'
);
const MAX_RUST_LINES = 950;
const SOURCE = 'rust/protocol/puppeteer/api.json';

const RUST_KEYWORDS = new Set(
  (
    'as async await break const continue crate dyn else enum extern false fn ' +
    'for if impl in let loop match mod move mut pub ref return self static ' +
    'struct super trait true type unsafe use where while abstract become box ' +
    'do final macro override priv typeof unsized virtual yield try gen'
  ).split(' ')
);
const PYTHON_KEYWORDS = new Set(
  (
    'False None True and as assert async await break class continue def del ' +
    'elif else except finally for from global if import in is lambda nonlocal ' +
    'not or pass raise return try while with yield'
  ).split(' ')
);
/** Method names that would shadow what the wrappers already provide. */
const RUST_RESERVED = new Set([
  'clone',
  'eq',
  'ne',
  'fmt',
  'remote',
  'from_remote',
  'cast',
  'from_wire',
]);
const PYTHON_RESERVED = new Set(['remote', 'cast', 'TYPE']);
/** Names the bridge module exports, which the generated code imports. */
const BRIDGE_NAMES = new Set([
  'BridgeError',
  'JsFunction',
  'Remote',
  'RemoteHandle',
  'RemoteObject',
  'Value',
]);
/** Puppeteer's `$`-prefixed query helpers, named as Puppeteer documents them. */
const QUERY_NAMES = {
  $: 'query_selector',
  $$: 'query_selector_all',
  $eval: 'eval_on_selector',
  $$eval: 'eval_on_selector_all',
};

/** `waitForSelector` -> `wait_for_selector`, `createCDPSession` -> `create_cdp_session`. */
export function snakeCase(name) {
  if (Object.hasOwn(QUERY_NAMES, name)) {
    return QUERY_NAMES[name];
  }
  const snake = name
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1_$2')
    .toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/u.test(snake)) {
    throw new Error(`Cannot name ${name} in Rust or Python`);
  }
  return snake;
}

/** The Rust method name of a Puppeteer member (`r#type`, `js_clone`). */
export function rustMethodName(name) {
  const snake = snakeCase(name);
  if (RUST_RESERVED.has(snake)) {
    return `js_${snake}`;
  }
  return RUST_KEYWORDS.has(snake) ? `r#${snake}` : snake;
}

/** The Python method name of a Puppeteer member (`from_`, `js_cast`). */
export function pythonMethodName(name) {
  const snake = snakeCase(name);
  if (PYTHON_RESERVED.has(snake)) {
    return `js_${snake}`;
  }
  return PYTHON_KEYWORDS.has(snake) ? `${snake}_` : snake;
}

function rustParamName(name) {
  const snake = snakeCase(name);
  return RUST_KEYWORDS.has(snake) ? `${snake}_` : snake;
}

function pythonParamName(name) {
  const snake = snakeCase(name);
  return PYTHON_KEYWORDS.has(snake) || snake === 'self' ? `${snake}_` : snake;
}

function stripNullable(kind) {
  return kind.endsWith('?') ? kind.slice(0, -1) : kind;
}

function handleType(kind) {
  const bare = stripNullable(kind);
  return bare.startsWith('handle:') ? bare.slice('handle:'.length) : null;
}

/** Every type a kind refers to (`list:handle:Page?` -> `Page`). */
function referencedTypes(kind, into) {
  const bare = stripNullable(kind);
  if (bare.startsWith('list:')) {
    referencedTypes(bare.slice('list:'.length), into);
  } else if (bare.startsWith('handle:') && bare !== 'handle:this') {
    into.add(bare.slice('handle:'.length));
  }
  return into;
}

/** A member as seen on `typeName`: `handle:this` becomes that type. */
function onType(method, typeName) {
  const resolve = (kind) =>
    kind.replace(/handle:this\b/gu, `handle:${typeName}`);
  return {
    ...method,
    returns: resolve(method.returns),
    params: method.params.map((param) => ({
      ...param,
      type: resolve(param.type),
    })),
  };
}

function rustString(text) {
  return JSON.stringify(text);
}

export function loadManifest(file = MANIFEST_PATH) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * The manifest, one member per line so that a Puppeteer upgrade shows up as
 * a readable diff.
 */
export function formatManifest(manifest) {
  const lines = [
    '{',
    `  "package": ${JSON.stringify(manifest.package)},`,
    `  "version": ${JSON.stringify(manifest.version)},`,
    '  "types": [',
  ];
  manifest.types.forEach((type, typeIndex) => {
    lines.push(
      `    {"name": ${JSON.stringify(type.name)}, "extends": ${JSON.stringify(type.extends)}, "methods": [`
    );
    type.methods.forEach((method, index) => {
      const comma = index < type.methods.length - 1 ? ',' : '';
      lines.push(`      ${JSON.stringify(method)}${comma}`);
    });
    lines.push(`    ]}${typeIndex < manifest.types.length - 1 ? ',' : ''}`);
  });
  lines.push('  ]', '}', '');
  return lines.join('\n');
}

/** Types to wrap: the manifest's, plus handle types only ever returned. */
function wrappedTypes(manifest) {
  const types = new Map(manifest.types.map((type) => [type.name, type]));
  const referenced = new Set();
  for (const type of manifest.types) {
    if (type.extends) {
      referenced.add(type.extends);
    }
    for (const method of type.methods) {
      referencedTypes(method.returns, referenced);
      for (const param of method.params) {
        referencedTypes(param.type, referenced);
      }
    }
  }
  for (const name of referenced) {
    if (!types.has(name)) {
      types.set(name, { name, extends: null, methods: [] });
    }
  }
  for (const name of types.keys()) {
    if (BRIDGE_NAMES.has(name)) {
      throw new Error(`Puppeteer type ${name} clashes with the bridge`);
    }
  }
  return [...types.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function checkUnique(type, names) {
  const seen = new Map();
  for (const [member, name] of names) {
    if (seen.has(name)) {
      throw new Error(
        `${type.name}.${member} and ${type.name}.${seen.get(name)} are both ${name}`
      );
    }
    seen.set(name, member);
  }
}

// ---------------------------------------------------------------- Rust ---

const RUST_HEADER = [
  '// @generated by scripts/generate-puppeteer-bindings.mjs from',
  `// ${SOURCE}. Do not edit by hand.`,
];

/** Element types a slice parameter can hold directly. */
function rustListElement(kind) {
  if (kind === 'string') {
    return { type: '&str', encode: (v) => `Value::from(*${v})` };
  }
  if (kind === 'number' || kind === 'boolean') {
    return {
      type: kind === 'number' ? 'f64' : 'bool',
      encode: (v) => `Value::from(*${v})`,
    };
  }
  const handle = kind.startsWith('handle:') ? kind.slice(7) : null;
  if (handle) {
    return { type: `&${handle}`, encode: (v) => `${v}.remote().to_wire()` };
  }
  return null;
}

/**
 * How a parameter of a bare (non-nullable) kind is declared and encoded.
 * `owned` is the type inside `Option<…>`, where `impl Trait` cannot go.
 */
function rustParamKind(kind) {
  switch (kind) {
    case 'string':
      return { type: '&str', encode: (x) => `Value::from(${x})` };
    case 'number':
      return { type: 'f64', encode: (x) => `Value::from(${x})` };
    case 'boolean':
      return { type: 'bool', encode: (x) => `Value::from(${x})` };
    case 'binary':
      return { type: '&[u8]', encode: (x) => `binary(${x})` };
    case 'function':
      return {
        type: 'impl Into<JsFunction>',
        owned: 'JsFunction',
        encode: (x) => `${x}.into().to_wire()`,
        encodeOwned: (x) => `${x}.to_wire()`,
      };
    default:
      break;
  }
  const handle = handleType(kind);
  if (handle) {
    return { type: `&${handle}`, encode: (x) => `${x}.remote().to_wire()` };
  }
  if (kind.startsWith('list:')) {
    const element = rustListElement(kind.slice(5));
    if (element) {
      return {
        type: `&[${element.type}]`,
        encode: (x) =>
          `Value::Array(${x}.iter().map(|v| ${element.encode('v')}).collect())`,
      };
    }
    return { type: 'Vec<Value>', encode: (x) => `Value::Array(${x})` };
  }
  return { type: 'Value', encode: (x) => x };
}

/** The declared Rust type and the `Option<Value>` argument of a parameter. */
function rustParam(param) {
  const name = rustParamName(param.name);
  const nullable = param.type.endsWith('?');
  const kind = rustParamKind(stripNullable(param.type));
  if (param.rest) {
    const element = rustListElement(stripNullable(param.type)) ?? {
      type: 'Value',
      encode: (v) => `${v}.clone()`,
    };
    return {
      name,
      declaration: `${name}: &[${element.type}]`,
      rest: `${name}.iter().map(|v| Some(${element.encode('v')}))`,
    };
  }
  if (!param.optional && !nullable) {
    return {
      name,
      declaration: `${name}: ${kind.type}`,
      argument: `Some(${kind.encode(name)})`,
    };
  }
  const inner = kind.owned ?? kind.type;
  const encode = kind.encodeOwned ?? kind.encode;
  const mapped = encode('x') === 'x' ? name : `${name}.map(|x| ${encode('x')})`;
  return {
    name,
    declaration: `${name}: Option<${inner}>`,
    // A missing optional argument is `undefined`; a required nullable one
    // is `null`.
    argument: param.optional
      ? mapped
      : `Some(${mapped}.unwrap_or(Value::Null))`,
  };
}

function rustReturn(kind) {
  if (kind.endsWith('?')) {
    const inner = stripNullable(kind);
    return inner === 'void' ? '()' : `Option<${rustReturn(inner)}>`;
  }
  switch (kind) {
    case 'void':
      return '()';
    case 'string':
      return 'String';
    case 'number':
      return 'f64';
    case 'boolean':
      return 'bool';
    case 'binary':
      return 'Vec<u8>';
    case 'json':
    case 'function':
      return 'Value';
    default:
      break;
  }
  if (kind.startsWith('list:')) {
    return `Vec<${rustReturn(kind.slice(5))}>`;
  }
  return handleType(kind) ?? 'Value';
}

function rustDocs(method, indent) {
  const lines = [
    `${indent}/// \`${method.owner}.${method.name}\``,
    `${indent}///`,
    `${indent}/// \`\`\`text`,
    ...method.signatures.map((signature) => `${indent}/// ${signature}`),
    `${indent}/// \`\`\``,
  ];
  return lines;
}

function rustMethod(method) {
  const name = rustMethodName(method.name);
  const result = `Result<${rustReturn(method.returns)}, BridgeError>`;
  const lines = rustDocs(method, '    ');
  if (method.kind === 'getter') {
    lines.push(
      `    pub async fn ${name}(&self) -> ${result} {`,
      `        self.remote.get(${rustString(method.name)}).await`,
      '    }'
    );
    return lines;
  }
  const params = method.params.map(rustParam);
  const declarations = ['&self', ...params.map((p) => p.declaration)];
  lines.push(
    `    pub async fn ${name}(${declarations.join(', ')}) -> ${result} {`
  );
  const fixed = params.filter((p) => !p.rest).map((p) => p.argument);
  const rest = params.find((p) => p.rest);
  if (rest) {
    lines.push(
      `        let mut call_args: Vec<Option<Value>> = vec![${fixed.join(', ')}];`,
      `        call_args.extend(${rest.rest});`,
      `        self.remote.call(${rustString(method.name)}, call_args).await`
    );
  } else {
    lines.push(
      `        self.remote.call(${rustString(method.name)}, vec![${fixed.join(', ')}]).await`
    );
  }
  lines.push('    }');
  return lines;
}

function rustTypeDocs(type, version) {
  const lines = [
    `/// Puppeteer's \`${type.name}\` (puppeteer-core ${version}), a remote object`,
    '/// served by `browser-commander serve --stdio`.',
  ];
  if (type.extends) {
    lines.push(
      '///',
      `/// Extends [\`${type.extends}\`]; the inherited methods are repeated here.`
    );
  }
  if (!type.methods.length) {
    lines.push(
      '///',
      '/// The declaration file lists no public methods for it; use',
      '/// [`Remote::remote`] for untyped calls.'
    );
  }
  return lines;
}

function generateRust(manifest, types) {
  const files = new Map();
  const modules = [];
  const preamble = [
    ...RUST_HEADER,
    '',
    '#![allow(clippy::all, missing_docs, unused_imports, non_snake_case)]',
    '',
    'use serde_json::Value;',
    '',
    'use super::*;',
    'use crate::puppeteer::bridge::{binary, remote_type, BridgeError, JsFunction, Remote};',
    '',
  ];
  let methodCount = 0;
  for (const type of types) {
    checkUnique(
      type,
      type.methods.map((method) => [method.name, rustMethodName(method.name)])
    );
    const unit = snakeCase(type.name);
    const methods = type.methods.map((method) =>
      rustMethod(onType(method, type.name))
    );
    methodCount += methods.length;
    let part = 1;
    let current = [
      `remote_type!(`,
      ...rustTypeDocs(type, manifest.version).map((line) => `    ${line}`),
      `    ${type.name}`,
      ');',
    ];
    const flush = (last) => {
      const module = part === 1 ? unit : `${unit}_${part}`;
      modules.push({ module, first: part === 1 });
      const body = [...preamble, ...current];
      files.set(`${module}.rs`, `${body.join('\n')}\n`);
      part += 1;
      current = [];
      return last;
    };
    let open = false;
    for (const lines of methods) {
      const projected =
        preamble.length + current.length + lines.length + (open ? 2 : 4);
      if (open && projected > MAX_RUST_LINES) {
        current.push('}');
        flush(false);
        open = false;
      }
      if (!open) {
        if (current.length) {
          current.push('');
        }
        current.push(`impl ${type.name} {`);
        open = true;
      } else {
        current.push('');
      }
      current.push(...lines);
    }
    if (open) {
      current.push('}');
    }
    flush(true);
  }
  files.set(
    'mod.rs',
    [
      ...RUST_HEADER,
      '',
      "//! Typed wrappers of Puppeteer's API, generated from the declaration file",
      '//! that puppeteer-core ships.',
      '//!',
      `//! ${types.length} types and ${methodCount} methods and getters, each a typed`,
      '//! `handle.call` or `handle.get` over [`crate::puppeteer::bridge`].',
      '',
      '/// puppeteer-core release the wrappers were generated from.',
      `pub const PUPPETEER_VERSION: &str = ${rustString(manifest.version)};`,
      '',
      ...modules.map(({ module }) => `mod ${module};`),
      '',
      ...modules
        .filter(({ first }) => first)
        .map(({ module }) => `pub use ${module}::*;`),
      '',
    ].join('\n')
  );
  return files;
}

// -------------------------------------------------------------- Python ---

const PYTHON_HEADER = [
  '# @generated by scripts/generate-puppeteer-bindings.mjs from',
  `# ${SOURCE}. Do not edit by hand.`,
];

function pythonKind(kind, uses) {
  if (kind.endsWith('?')) {
    const inner = stripNullable(kind);
    return inner === 'void' ? 'None' : `${pythonKind(inner, uses)} | None`;
  }
  switch (kind) {
    case 'void':
      return 'None';
    case 'string':
      return 'str';
    case 'number':
      return 'float';
    case 'boolean':
      return 'bool';
    case 'binary':
      return 'bytes';
    case 'function':
      uses.add('JsFunction');
      return 'str | JsFunction';
    case 'json':
      uses.add('Any');
      return 'Any';
    default:
      break;
  }
  if (kind.startsWith('list:')) {
    return `list[${pythonKind(kind.slice(5), uses)}]`;
  }
  const handle = handleType(kind);
  if (handle) {
    uses.add(`handle:${handle}`);
    return handle;
  }
  uses.add('Any');
  return 'Any';
}

function pythonDocstring(method) {
  const escape = (text) =>
    text.replace(/\\/gu, '\\\\').replace(/"""/gu, '\\"\\"\\"');
  return [
    `        """\`\`${method.owner}.${method.name}\`\`.`,
    '',
    '        .. code-block:: typescript',
    '',
    ...method.signatures.map((signature) => `            ${escape(signature)}`),
    '        """',
  ];
}

function pythonMethod(method, uses) {
  const name = pythonMethodName(method.name);
  const returns = pythonKind(method.returns, uses);
  const kind = JSON.stringify(method.returns);
  const lines = [];
  if (method.kind === 'getter') {
    lines.push(
      `    async def ${name}(self) -> ${returns}:`,
      ...pythonDocstring(method),
      `        return await self._get(${JSON.stringify(method.name)}, ${kind})`
    );
    return lines;
  }
  const declarations = ['self'];
  const args = [];
  for (const param of method.params) {
    const paramName = pythonParamName(param.name);
    const type = pythonKind(param.type, uses);
    if (param.rest) {
      declarations.push(`*${paramName}: ${type}`);
      args.push(`*${paramName}`);
    } else if (param.optional) {
      declarations.push(
        `${paramName}: ${type.endsWith(' | None') ? type : `${type} | None`} = None`
      );
      uses.add('_opt');
      args.push(`_opt(${paramName})`);
    } else {
      declarations.push(`${paramName}: ${type}`);
      args.push(paramName);
    }
  }
  lines.push(
    `    async def ${name}(${declarations.join(', ')}) -> ${returns}:`,
    ...pythonDocstring(method),
    `        return await self._call(${JSON.stringify(method.name)}, [${args.join(', ')}], ${kind})`
  );
  return lines;
}

function generatePython(manifest, types) {
  const files = new Map();
  const byName = new Map(types.map((type) => [type.name, type]));
  for (const type of types) {
    const own = type.methods.filter((method) => method.owner === type.name);
    // Python inherits, so only the type's own members are declared here;
    // still, its names must not clash with inherited ones.
    checkUnique(
      type,
      type.methods.map((method) => [method.name, pythonMethodName(method.name)])
    );
    const uses = new Set();
    const body = own.flatMap((method) => [
      '',
      ...pythonMethod(onType(method, type.name), uses),
    ]);
    const base = type.extends && byName.has(type.extends) ? type.extends : null;
    const handles = [...uses]
      .filter((use) => use.startsWith('handle:'))
      .map((use) => use.slice(7))
      .filter((name) => name !== type.name && name !== base)
      .sort();
    const typing = [
      ...(handles.length ? ['TYPE_CHECKING'] : []),
      ...(uses.has('Any') ? ['Any'] : []),
    ];
    const bridge = [
      ...(uses.has('JsFunction') ? ['JsFunction'] : []),
      ...(base ? [] : ['RemoteObject']),
      ...(uses.has('_opt') ? ['_opt'] : []),
    ];
    const lines = [
      ...PYTHON_HEADER,
      // A subclass's overload set can differ from its parent's (`Page.on`).
      '# mypy: disable-error-code="override"',
      `"""Puppeteer's \`\`${type.name}\`\` (puppeteer-core ${manifest.version})."""`,
      '',
      'from __future__ import annotations',
      '',
      ...(typing.length ? [`from typing import ${typing.join(', ')}`, ''] : []),
    ];
    if (bridge.length) {
      lines.push(`from ..bridge import ${bridge.join(', ')}`);
    }
    if (base) {
      lines.push(`from .${snakeCase(base)} import ${base}`);
    }
    if (handles.length) {
      lines.push(
        '',
        'if TYPE_CHECKING:',
        ...handles.map((name) => `    from .${snakeCase(name)} import ${name}`)
      );
    }
    lines.push(
      '',
      '',
      `class ${type.name}(${base ?? 'RemoteObject'}):`,
      `    """Puppeteer's \`\`${type.name}\`\`, a remote object served by \`\`serve --stdio\`\`."""`,
      '',
      `    TYPE = ${JSON.stringify(type.name)}`,
      ...body,
      ''
    );
    files.set(`${snakeCase(type.name)}.py`, lines.join('\n'));
  }
  // Ordinal order, as ruff's RUF022 expects.
  const names = types
    .map((type) => type.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  files.set(
    '__init__.py',
    [
      ...PYTHON_HEADER,
      `"""Typed wrappers of Puppeteer's API (puppeteer-core ${manifest.version}).`,
      '',
      `${types.length} types; importing this package registers them with the bridge.`,
      '"""',
      '',
      ...types.map(
        (type) => `from .${snakeCase(type.name)} import ${type.name}`
      ),
      '',
      `PUPPETEER_VERSION = ${JSON.stringify(manifest.version)}`,
      '',
      '__all__ = [',
      '    "PUPPETEER_VERSION",',
      ...names.map((name) => `    ${JSON.stringify(name)},`),
      ']',
      '',
    ].join('\n')
  );
  return files;
}

/**
 * Generate both languages' wrappers.
 *
 * @returns {{rust: Map<string, string>, python: Map<string, string>}}
 */
export function generatePuppeteerBindings(manifest = loadManifest()) {
  const types = wrappedTypes(manifest);
  return {
    rust: generateRust(manifest, types),
    python: generatePython(manifest, types),
  };
}

function compare(dir, files, extension, problems) {
  for (const [file, contents] of files) {
    const target = path.join(dir, file);
    if (!existsSync(target)) {
      problems.push(`missing ${target}`);
    } else if (readFileSync(target, 'utf8') !== contents) {
      problems.push(`stale ${target}`);
    }
  }
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(extension))) {
      if (!files.has(file)) {
        problems.push(`unexpected ${path.join(dir, file)}`);
      }
    }
  }
}

function write(dir, files, extension) {
  mkdirSync(dir, { recursive: true });
  for (const file of readdirSync(dir).filter((f) => f.endsWith(extension))) {
    if (!files.has(file)) {
      rmSync(path.join(dir, file));
    }
  }
  for (const [file, contents] of files) {
    writeFileSync(path.join(dir, file), contents);
  }
}

async function main(argv) {
  if (argv.includes('--update-api')) {
    const { extractPuppeteerApi, installedPuppeteer } =
      await import('./puppeteer-api.mjs');
    const { version, source } = installedPuppeteer();
    const { types } = extractPuppeteerApi(source);
    mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
    writeFileSync(
      MANIFEST_PATH,
      formatManifest({ package: 'puppeteer-core', version, types })
    );
    console.log(`Extracted the API of puppeteer-core ${version}.`);
  }
  const { rust, python } = generatePuppeteerBindings();
  if (argv.includes('--check')) {
    const problems = [];
    compare(RUST_DIR, rust, '.rs', problems);
    compare(PYTHON_DIR, python, '.py', problems);
    if (problems.length) {
      console.error(
        `Puppeteer bindings are out of date (${problems.join(', ')}).\n` +
          'Run: node scripts/generate-puppeteer-bindings.mjs'
      );
      process.exit(1);
    }
    console.log(
      `Puppeteer bindings are up to date (${rust.size} Rust, ${python.size} Python files).`
    );
    return;
  }
  write(RUST_DIR, rust, '.rs');
  write(PYTHON_DIR, python, '.py');
  console.log(
    `Wrote ${rust.size} Rust and ${python.size} Python files for Puppeteer.`
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main(process.argv.slice(2));
}
