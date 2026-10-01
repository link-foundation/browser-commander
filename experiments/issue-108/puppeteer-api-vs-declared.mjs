// Compare the TypeScript-based extraction with the line-based declared list.
import { extractPuppeteerApi, installedPuppeteer } from '../../scripts/puppeteer-api.mjs';
import { puppeteerDeclarations } from '../../js/tests/helpers/declared-api.js';

const api = extractPuppeteerApi(installedPuppeteer().source);
const extracted = new Map(api.types.map((t) => [t.name, new Set(t.methods.map((m) => m.name))]));
const missing = [];
for (const [type, methods] of puppeteerDeclarations()) {
  for (const method of methods) {
    if (!extracted.get(type)?.has(method)) missing.push(`${type}.${method}`);
  }
}
console.log('declared but not extracted:', missing);
