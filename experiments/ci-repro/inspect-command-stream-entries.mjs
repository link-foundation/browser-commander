#!/usr/bin/env node
/**
 * Show which entry point `require` picks for each published command-stream
 * version, and when each version was published.
 *
 * use-m resolves a package with `createRequire(...).resolve`, so the entry that
 * `require` selects is the file use-m imports. command-stream switched that
 * entry from ESM to CommonJS in 0.19.0, which is what turned
 * `const { $ } = await use('command-stream')` into `undefined` on Node 24.
 *
 * Usage: node experiments/ci-repro/inspect-command-stream-entries.mjs [package]
 */

const pkg = process.argv[2] || 'command-stream';
const meta = await (await fetch(`https://registry.npmjs.org/${pkg}`)).json();
const times = meta.time || {};

/** Resolve the file `require('<pkg>')` would load, per package.json fields. */
function requireEntry(manifest) {
  const exports = manifest.exports;
  if (typeof exports === 'string') return exports;
  if (exports && typeof exports === 'object') {
    const root = exports['.'] ?? exports;
    if (typeof root === 'string') return root;
    if (root && typeof root === 'object') {
      const target = root.require ?? root.node ?? root.default;
      if (typeof target === 'string') return target;
      if (target && typeof target === 'object') {
        return target.require ?? target.default ?? JSON.stringify(target);
      }
    }
  }
  return manifest.main || 'index.js (implicit)';
}

const versions = Object.keys(meta.versions).sort((a, b) =>
  times[a] < times[b] ? -1 : 1
);

console.log(`package: ${pkg}`);
console.log('version'.padEnd(10), 'published'.padEnd(26), 'require entry');
for (const version of versions) {
  const manifest = meta.versions[version];
  console.log(
    version.padEnd(10),
    (times[version] || '').padEnd(26),
    requireEntry(manifest),
    manifest.type === 'module' ? '(type: module)' : ''
  );
}
