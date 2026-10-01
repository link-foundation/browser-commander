// Summarise what scripts/puppeteer-api.mjs extracts from the installed
// puppeteer-core declaration file: types, members and wire-type counts.
import {
  extractPuppeteerApi,
  installedPuppeteer,
} from '../../scripts/puppeteer-api.mjs';

const { version, source } = installedPuppeteer();
const { types } = extractPuppeteerApi(source);
const kinds = new Map();
let members = 0;
for (const type of types) {
  members += type.methods.length;
  for (const method of type.methods) {
    for (const kind of [method.returns, ...method.params.map((p) => p.type)]) {
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
  }
}
console.log(
  `puppeteer-core ${version}: ${types.length} types, ${members} members`
);
console.log(types.map((t) => `${t.name}(${t.methods.length})`).join(' '));
console.log([...kinds].sort((a, b) => b[1] - a[1]));
const page = types.find((t) => t.name === process.argv[2]);
if (page) {
  for (const m of page.methods) {
    console.log(
      m.owner,
      m.kind,
      m.name,
      JSON.stringify(m.params),
      '->',
      m.returns
    );
  }
}
