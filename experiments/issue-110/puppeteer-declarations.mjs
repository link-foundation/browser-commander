// Inventory the pinned declaration grammar before generating both host APIs.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../js/package.json', import.meta.url));
const ts = require('typescript');
const source = ts.createSourceFile('types.d.ts', await fs.readFile(new URL('../../js/node_modules/puppeteer-core/lib/types.d.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const kinds = new Map();
const classes = [];
function visit(node) {
  if (ts.isTypeNode(node)) {
    const kind = ts.SyntaxKind[node.kind];
    const item = kinds.get(kind) ?? { count: 0, examples: [] };
    item.count++;
    if (item.examples.length < 3) item.examples.push(node.getText(source));
    kinds.set(kind, item);
  }
  ts.forEachChild(node, visit);
}
visit(source);
for (const node of source.statements) {
  if (!ts.isClassDeclaration(node) || !node.name) continue;
  const methods = node.members.filter(member => (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isPropertyDeclaration(member)) && member.name && !ts.isPrivateIdentifier(member.name) && !member.modifiers?.some(modifier => [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(modifier.kind)));
  classes.push({ name: node.name.text, count: methods.length, methods: methods.map(method => method.name.getText(source)) });
}
process.stdout.write(JSON.stringify({classes, kinds: Object.fromEntries(kinds)}, null, 2) + '\n');
