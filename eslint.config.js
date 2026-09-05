/**
 * ESLint for the JavaScript that lives outside the `js/` package.
 *
 * `npm run lint` in `js/` cannot reach these files: ESLint takes its base path
 * from the directory of the config file it loads, so with the config inside
 * `js/` every path above it is "outside of the base path" and is silently
 * skipped - `npx eslint ../scripts` exits 2 without checking anything. The
 * result was 255 errors in `scripts/`, `experiments/` and `rust/scripts/` that
 * no gate had ever looked at, in exactly the shell-out helpers that CI depends
 * on.
 *
 * The rules are the ones the `js/` package uses, imported rather than copied so
 * the two cannot drift. `js/eslint.config.js` resolves its own `@eslint/js` and
 * Prettier plugin imports from `js/node_modules`, which is why this file has no
 * dependencies of its own and needs no second lockfile at the repository root.
 *
 * Run it (from the repository root, after `npm ci` in `js/`):
 *   node js/node_modules/eslint/bin/eslint.js scripts experiments rust/scripts
 */

import jsPackageRules from './js/eslint.config.js';

export default [
  ...jsPackageRules,
  {
    // The probe is source text, not a module: the harness reads the file and
    // wraps it as `(<file contents>)()` for `page.evaluate`, `Runtime.evaluate`
    // and a plain `<script>` tag, so its single declaration has no caller in
    // this repository by construction, and its length is the surface of the
    // browser API it measures rather than a function that grew. Same reasoning
    // as `js/src/fingerprint/init-payload.js`, which the package config exempts
    // from `no-unused-vars` for exactly this reason. Every other rule still
    // applies; remove these two lines if the file ever stops being a payload.
    files: ['experiments/fingerprint-parity/probe.js'],
    rules: {
      'no-unused-vars': 'off',
      'max-lines-per-function': 'off',
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      // Linted by `npm run lint` inside the package, with the same rules.
      'js/**',
      // Frozen evidence: verbatim upstream copies and captured CI output.
      'docs/case-studies/*/template-snapshots/**',
      'dev/log/**',
      'ci-logs/**',
      'rust/target/**',
      '**/coverage/**',
    ],
  },
];
