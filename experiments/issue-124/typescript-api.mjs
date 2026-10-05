import { createRequire } from 'node:module';
const require = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const { API } = require('typescript/unstable/sync');
const { createVirtualFileSystem } = require('typescript/unstable/fs');
const api = new API({
  cwd: '/virtual',
  fs: createVirtualFileSystem({
    '/virtual/tsconfig.json': JSON.stringify({
      files: ['types.d.ts'],
      compilerOptions: { noLib: true },
    }),
    '/virtual/types.d.ts':
      'export declare class Page { foo(arg: string): Promise<string>; }',
  }),
});
try {
  const snapshot = api.updateSnapshot({
    openProjects: ['/virtual/tsconfig.json'],
  });
  console.log(snapshot.getProjects().map((p) => p.configFileName));
  const file = snapshot
    .getProjects()[0]
    .program.getSourceFile('/virtual/types.d.ts');
  const node = file.statements[0];
  console.log(
    node.name.text,
    node.modifiers,
    node.members[0].name.text,
    node.members[0].getText(file)
  );
} finally {
  api.close();
}
