// Issue #128: show why parseDeclarations found no project on Windows.
// TypeScript 7's createVirtualFileSystem matches exact keys, and its native
// compiler asks for forward-slash paths, so a key built by path.win32.join is
// never found. Run from the repository root: node experiments/ts-virtual-fs-windows-keys.mjs
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.resolve('js/package.json'));
const { createVirtualFileSystem } = require('typescript/unstable/fs');

const root = 'D:\\a\\browser-commander\\browser-commander';
const backslashKey = path.win32.join(root, 'tsconfig.json');
const slashKey = backslashKey.replaceAll('\\', '/');

const vfs = createVirtualFileSystem({ [backslashKey]: '{}' });
console.log('key written      :', backslashKey);
console.log('compiler asks for:', slashKey);
console.log('fileExists       :', vfs.fileExists(slashKey));
console.log('readFile         :', vfs.readFile(slashKey));

const fixed = createVirtualFileSystem({ [slashKey]: '{}' });
console.log('with "/" keys    :', fixed.fileExists(slashKey));
