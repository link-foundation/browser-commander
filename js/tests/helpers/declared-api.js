/**
 * The public methods an engine declares in its TypeScript definitions
 * (issue #104, API coverage).
 *
 * `serve --stdio` promises that the generic handle methods reach every public
 * Playwright and Puppeteer method. The authoritative list of those methods is
 * what each package ships for TypeScript users:
 *
 * - Puppeteer: `puppeteer-core/lib/types.d.ts` (`export declare class …`).
 * - Playwright: `playwright-core/types/types.d.ts` (`export interface …`).
 *   Playwright's wire protocol description (`protocol.yml`) is not shipped
 *   in the npm package, so the client API declarations are used instead.
 *
 * Both files put every member of a class or interface on a line indented by
 * exactly two spaces, which is all this parser relies on.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const BLOCK_START =
  /^export (?:declare )?(?:abstract )?(?:class|interface) ([A-Za-z]\w*)/u;
const MEMBER =
  /^ {2}(?:(?:public|abstract|async|override)\s+)*([A-Za-z$][\w$]*)\??(?:<|\()/u;
const NOT_A_METHOD = /^ {2}(?:private|protected|static|get|set|readonly)\s/u;

/**
 * Methods declared directly on each class or interface of a `.d.ts` file.
 * Private, protected and static members, accessors, the constructor and
 * `_`-prefixed names are left out.
 *
 * @param {string} source - The declaration file contents
 * @returns {Map<string, Set<string>>} Type name to method names
 */
export function parseDeclaredMethods(source) {
  const types = new Map();
  let current = null;
  for (const line of source.split(/\r?\n/u)) {
    const start = BLOCK_START.exec(line);
    if (start) {
      current = new Set();
      types.set(start[1], current);
      continue;
    }
    if (line === '}') {
      current = null;
      continue;
    }
    if (!current || NOT_A_METHOD.test(line)) {
      continue;
    }
    const name = MEMBER.exec(line)?.[1];
    if (name && name !== 'constructor' && !name.startsWith('_')) {
      current.add(name);
    }
  }
  return types;
}

/** The declaration file of an installed package. */
function declarationFile(packageName, relative) {
  const root = path.dirname(require.resolve(`${packageName}/package.json`));
  return readFileSync(path.join(root, relative), 'utf8');
}

/** Puppeteer's declared classes and their methods. */
export function puppeteerDeclarations() {
  return parseDeclaredMethods(
    declarationFile('puppeteer-core', 'lib/types.d.ts')
  );
}

/** Playwright's declared interfaces and their methods. */
export function playwrightDeclarations() {
  return parseDeclaredMethods(
    declarationFile('playwright-core', 'types/types.d.ts')
  );
}
