/**
 * Read Puppeteer's public API from the `.d.ts` file it ships (issue #108).
 *
 * `puppeteer-core/lib/types.d.ts` is the declaration file TypeScript users
 * compile against. This module parses it with the TypeScript compiler and
 * reduces every exported class and interface to the methods a client in
 * another language can call over `serve --stdio`:
 *
 * - methods (all overloads) and `get` accessors, own and inherited from other
 *   declared types; private, protected, static, `_`-prefixed and symbol-named
 *   members are left out, as they are not part of the public API;
 * - each parameter's name, whether it is optional or a rest parameter, and a
 *   wire type: `string`, `number`, `boolean`, `binary`, `function`, `json`,
 *   `void`, `handle:<Type>` or `list:<type>`, with a trailing `?` when `null`
 *   or `undefined` is allowed; `handle:this` is the type the member is called
 *   on (`on(…): this`).
 *
 * Anything the bridge sends as plain JSON (option bags, cookies, unions of
 * unrelated types) is `json`. Promises are unwrapped because the bridge awaits
 * every call.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'js', 'package.json'));

/** Types sent as raw bytes (`$binary`). */
const BINARY = new Set(['Uint8Array', 'Buffer', 'ArrayBuffer']);
/** Generic wrappers whose first type argument is the real type. */
const TRANSPARENT = new Set([
  'Promise',
  'Readonly',
  'Awaitable',
  'Awaited',
  'NonNullable',
]);
/** Puppeteer's helper types that always resolve to a handle. */
const HANDLE_ALIASES = { HandleFor: 'JSHandle', HandleOr: 'JSHandle' };

function ts() {
  return require('typescript/unstable/ast');
}

/**
 * Paths of the virtual project, with forward slashes on every platform.
 *
 * The virtual file system matches file names as exact keys, and the native
 * compiler asks for them with `/`. Keys from `path.join` on Windows use `\`,
 * so nothing was found there and the project came back undefined (issue #128).
 */
export function virtualProjectPaths(root = ROOT) {
  const cwd = `${root.replaceAll('\\', '/')}/experiments/puppeteer-api-virtual`;
  return {
    cwd,
    config: `${cwd}/tsconfig.json`,
    declaration: `${cwd}/types.d.ts`,
  };
}

/** Parse declarations with TypeScript 7's native compiler and virtual files. */
function parseDeclarations(source) {
  const { API } = require('typescript/unstable/sync');
  const { createVirtualFileSystem } = require('typescript/unstable/fs');
  const { cwd, config, declaration } = virtualProjectPaths();
  const api = new API({
    cwd,
    fs: createVirtualFileSystem({
      [config]: JSON.stringify({
        files: ['types.d.ts'],
        compilerOptions: { noLib: true },
      }),
      [declaration]: source,
    }),
  });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [config] });
    return snapshot.getProject(config).program.getSourceFile(declaration);
  } finally {
    api.close();
  }
}

function hasModifier(node, kind) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === kind));
}

function isNullish(type) {
  const t = ts();
  if (
    type.kind === t.SyntaxKind.UndefinedKeyword ||
    type.kind === t.SyntaxKind.VoidKeyword
  ) {
    return true;
  }
  return (
    t.isLiteralTypeNode(type) && type.literal.kind === t.SyntaxKind.NullKeyword
  );
}

function nullable(kind) {
  return kind.endsWith('?') ? kind : `${kind}?`;
}

function stripNullable(kind) {
  return kind.endsWith('?') ? kind.slice(0, -1) : kind;
}

/**
 * Turns TypeScript type nodes into wire types, knowing which names are
 * declared classes or interfaces (handles) and the type parameters in scope.
 */
class TypeClassifier {
  /**
   * @param {Set<string>} handles - Classes and method-only interfaces
   * @param {Map<string, Object>} aliases - `type X = …` declarations
   * @param {Map<string, string>} enums - Enum name to `string` or `number`
   */
  constructor(handles, aliases, enums) {
    this.handles = handles;
    this.aliases = aliases;
    this.enums = enums;
    this.resolving = new Set();
  }

  classify(type, scope) {
    const t = ts();
    if (!type) {
      return 'json';
    }
    switch (type.kind) {
      case t.SyntaxKind.StringKeyword:
      case t.SyntaxKind.TemplateLiteralType:
        return 'string';
      case t.SyntaxKind.NumberKeyword:
        return 'number';
      case t.SyntaxKind.BooleanKeyword:
        return 'boolean';
      case t.SyntaxKind.VoidKeyword:
      case t.SyntaxKind.UndefinedKeyword:
      case t.SyntaxKind.NeverKeyword:
        return 'void';
      case t.SyntaxKind.ThisType:
        // `on(…): this`; the generator substitutes the wrapper's own type.
        return 'handle:this';
      default:
        break;
    }
    if (t.isParenthesizedTypeNode(type)) {
      return this.classify(type.type, scope);
    }
    if (t.isLiteralTypeNode(type)) {
      return this.literal(type.literal);
    }
    if (t.isFunctionTypeNode(type) || t.isConstructorTypeNode(type)) {
      return 'function';
    }
    if (t.isArrayTypeNode(type)) {
      return `list:${this.classify(type.elementType, scope)}`;
    }
    if (t.isTypeOperatorNode(type)) {
      // `readonly string[]`
      return this.classify(type.type, scope);
    }
    if (t.isUnionTypeNode(type)) {
      return this.union(type.types, scope);
    }
    if (t.isTypeReferenceNode(type)) {
      return this.reference(type, scope);
    }
    return 'json';
  }

  literal(literal) {
    const t = ts();
    if (
      t.isStringLiteral(literal) ||
      t.isNoSubstitutionTemplateLiteral(literal)
    ) {
      return 'string';
    }
    if (t.isNumericLiteral(literal) || t.isPrefixUnaryExpression(literal)) {
      return 'number';
    }
    if (
      literal.kind === t.SyntaxKind.TrueKeyword ||
      literal.kind === t.SyntaxKind.FalseKeyword
    ) {
      return 'boolean';
    }
    if (literal.kind === t.SyntaxKind.NullKeyword) {
      return 'void';
    }
    return 'json';
  }

  union(types, scope) {
    const present = types.filter((type) => !isNullish(type));
    const optional = present.length < types.length;
    const kinds = [
      ...new Set(present.map((type) => this.classify(type, scope))),
    ];
    let kind;
    if (kinds.length === 0) {
      kind = 'void';
    } else if (kinds.length === 1) {
      kind = kinds[0];
    } else if (
      kinds.every((k) => ['function', 'string'].includes(k)) &&
      kinds.includes('function')
    ) {
      // `evaluate(pageFunction: Func | string)`: a function or an expression.
      kind = 'function';
    } else if (kinds.every((k) => k === 'boolean' || k === 'boolean?')) {
      kind = 'boolean';
    } else if (kinds.every((k) => k.startsWith('handle:'))) {
      kind =
        kinds.includes('handle:ElementHandle') &&
        kinds.includes('handle:JSHandle') &&
        kinds.length === 2
          ? 'handle:JSHandle'
          : 'json';
    } else {
      kind = 'json';
    }
    if (optional && kind !== 'void') {
      return nullable(kind);
    }
    return kind;
  }

  reference(type, scope) {
    const t = ts();
    const name = t.isIdentifier(type.typeName)
      ? type.typeName.text
      : type.typeName.right.text;
    const args = type.typeArguments ?? [];
    if (scope.has(name)) {
      const constraint = scope.get(name);
      return constraint ? this.classify(constraint, new Map()) : 'json';
    }
    if (TRANSPARENT.has(name)) {
      return args.length ? this.classify(args[0], scope) : 'json';
    }
    if (name === 'Array' || name === 'ReadonlyArray') {
      return `list:${args.length ? this.classify(args[0], scope) : 'json'}`;
    }
    if (BINARY.has(name)) {
      return 'binary';
    }
    if (name === 'Function') {
      return 'function';
    }
    if (HANDLE_ALIASES[name]) {
      return `handle:${HANDLE_ALIASES[name]}`;
    }
    if (this.handles.has(name)) {
      return `handle:${name}`;
    }
    if (this.enums.has(name)) {
      return this.enums.get(name);
    }
    if (this.aliases.has(name) && !this.resolving.has(name)) {
      // Type parameters of the alias are unknown here, so they become `json`.
      const alias = this.aliases.get(name);
      this.resolving.add(name);
      try {
        return this.classify(alias.type, typeScope(alias, new Map()));
      } finally {
        this.resolving.delete(name);
      }
    }
    return 'json';
  }
}

function parameterName(parameter, index) {
  const t = ts();
  return t.isIdentifier(parameter.name) ? parameter.name.text : `arg${index}`;
}

function typeScope(node, outer) {
  const scope = new Map(outer);
  for (const parameter of node.typeParameters ?? []) {
    scope.set(parameter.name.text, parameter.constraint ?? null);
  }
  return scope;
}

function memberName(member) {
  const t = ts();
  if (!member.name) {
    return null;
  }
  if (t.isIdentifier(member.name) || t.isStringLiteral(member.name)) {
    return member.name.text;
  }
  // `[disposeSymbol]()` and `#private` are not reachable by name.
  return null;
}

function isPublicMember(member) {
  const t = ts();
  return !(
    hasModifier(member, t.SyntaxKind.PrivateKeyword) ||
    hasModifier(member, t.SyntaxKind.ProtectedKeyword) ||
    hasModifier(member, t.SyntaxKind.StaticKeyword)
  );
}

function signatureText(member, sourceFile) {
  const text = member.getText(sourceFile).replace(/\s+/gu, ' ').trim();
  return text
    .replace(/^(?:(?:abstract|public|override|async)\s+)+/u, '')
    .replace(/;$/u, '')
    .replace(/\(\s+/gu, '(')
    .replace(/,\s*\)/gu, ')')
    .replace(/<\s+/gu, '<')
    .replace(/,\s*>/gu, '>');
}

/** Merge overloads: one entry per name, parameters joined by position. */
function mergeOverloads(name, overloads) {
  const width = Math.max(...overloads.map((o) => o.params.length));
  const params = [];
  for (let index = 0; index < width; index++) {
    const variants = overloads.map((o) => o.params[index]);
    const present = variants.filter(Boolean);
    const kinds = [...new Set(present.map((p) => p.type))];
    const bare = [...new Set(kinds.map(stripNullable))];
    let type = bare.length === 1 ? bare[0] : 'json';
    if (
      bare.length === 2 &&
      bare.includes('function') &&
      bare.includes('string')
    ) {
      // `locator(selector: string)` / `locator(func: () => …)`.
      type = 'function';
    }
    if (kinds.some((kind) => kind.endsWith('?'))) {
      type = nullable(type);
    }
    params.push({
      name: present[0].name,
      type,
      optional:
        present.length < variants.length || present.some((p) => p.optional),
      rest: present.some((p) => p.rest),
    });
  }
  const returns = [...new Set(overloads.map((o) => o.returns))];
  return {
    name,
    kind: overloads[0].kind,
    params,
    returns: returns.length === 1 ? returns[0] : 'json',
    signatures: overloads.map((o) => o.signature),
  };
}

function ownMembers(declaration, classifier, sourceFile) {
  const t = ts();
  const classScope = typeScope(declaration, new Map());
  const overloads = new Map();
  for (const member of declaration.members) {
    const name = memberName(member);
    if (!name || name === 'constructor' || name.startsWith('_')) {
      continue;
    }
    if (!isPublicMember(member)) {
      continue;
    }
    let entry;
    if (
      t.isMethodDeclaration(member) ||
      t.isMethodSignatureDeclaration(member)
    ) {
      const scope = typeScope(member, classScope);
      entry = {
        kind: 'method',
        params: member.parameters.map((parameter, index) => {
          const rest = Boolean(parameter.dotDotDotToken);
          let type = classifier.classify(parameter.type, scope);
          if (rest) {
            type = type.startsWith('list:')
              ? type.slice('list:'.length)
              : 'json';
          }
          return {
            name: parameterName(parameter, index),
            type,
            optional: Boolean(parameter.questionToken || parameter.initializer),
            rest,
          };
        }),
        returns: classifier.classify(member.type, scope),
      };
    } else if (t.isGetAccessorDeclaration(member)) {
      entry = {
        kind: 'getter',
        params: [],
        returns: classifier.classify(member.type, classScope),
      };
    } else {
      continue;
    }
    entry.signature = signatureText(member, sourceFile);
    if (!overloads.has(name)) {
      overloads.set(name, []);
    }
    overloads.get(name).push(entry);
  }
  return [...overloads].map(([name, list]) => mergeOverloads(name, list));
}

function heritageName(declaration) {
  const t = ts();
  for (const clause of declaration.heritageClauses ?? []) {
    if (clause.token !== t.SyntaxKind.ExtendsKeyword) {
      continue;
    }
    const expression = clause.types[0]?.expression;
    if (expression && t.isIdentifier(expression)) {
      return expression.text;
    }
  }
  return null;
}

/**
 * Classes are always remote objects. An interface is one only when it is
 * nothing but methods (`TouchHandle`, `BluetoothEmulation`); interfaces with
 * data members (`Cookie`, `GoToOptions`) cross the bridge as JSON.
 */
function isHandleType(declaration) {
  const t = ts();
  if (t.isClassDeclaration(declaration)) {
    return true;
  }
  const members = declaration.members;
  return (
    members.length > 0 &&
    members.every(
      (member) =>
        t.isMethodSignatureDeclaration(member) ||
        t.isGetAccessorDeclaration(member) ||
        t.isSetAccessorDeclaration(member)
    )
  );
}

/** `string` for an enum of string values, otherwise `number`. */
function enumKind(declaration) {
  const t = ts();
  return declaration.members.every(
    (member) => member.initializer && t.isStringLiteral(member.initializer)
  )
    ? 'string'
    : 'number';
}

/**
 * Extract the callable API from a declaration file.
 *
 * @param {string} source - The contents of `lib/types.d.ts`
 * @returns {{types: Array<{name: string, extends: string|null, methods: Array<Object>}>}}
 */
export function extractPuppeteerApi(source) {
  const t = ts();
  const sourceFile = parseDeclarations(source);
  const declarations = sourceFile.statements.filter(
    (statement) =>
      (t.isClassDeclaration(statement) ||
        t.isInterfaceDeclaration(statement)) &&
      statement.name &&
      hasModifier(statement, t.SyntaxKind.ExportKeyword)
  );
  const declared = new Set(declarations.map((d) => d.name.text));
  const classifier = new TypeClassifier(
    new Set(declarations.filter(isHandleType).map((d) => d.name.text)),
    new Map(
      sourceFile.statements
        .filter((statement) => t.isTypeAliasDeclaration(statement))
        .map((alias) => [alias.name.text, alias])
    ),
    new Map(
      sourceFile.statements
        .filter((statement) => t.isEnumDeclaration(statement))
        .map((declaration) => [declaration.name.text, enumKind(declaration)])
    )
  );
  const own = new Map();
  const parents = new Map();
  for (const declaration of declarations) {
    own.set(
      declaration.name.text,
      ownMembers(declaration, classifier, sourceFile)
    );
    const parent = heritageName(declaration);
    parents.set(
      declaration.name.text,
      parent && declared.has(parent) ? parent : null
    );
  }

  const resolved = new Map();
  const membersOf = (name) => {
    if (resolved.has(name)) {
      return resolved.get(name);
    }
    const parent = parents.get(name);
    const inherited = parent ? membersOf(parent) : [];
    const mine = own.get(name);
    const names = new Set(mine.map((member) => member.name));
    const all = [
      ...inherited.filter((member) => !names.has(member.name)),
      ...mine.map((member) => ({ owner: name, ...member })),
    ];
    resolved.set(name, all);
    return all;
  };

  const types = [];
  for (const name of [...declared].sort()) {
    const methods = membersOf(name);
    if (methods.length === 0) {
      continue;
    }
    types.push({ name, extends: parents.get(name), methods });
  }
  return { types };
}

/** The installed puppeteer-core declaration file and version. */
export function installedPuppeteer() {
  const { readFileSync } = require('node:fs');
  const root = path.dirname(require.resolve('puppeteer-core/package.json'));
  return {
    version: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
      .version,
    source: readFileSync(path.join(root, 'lib/types.d.ts'), 'utf8'),
  };
}
