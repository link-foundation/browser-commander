## Summary

The template's local gate is a husky hook:

```json
  "prepare": "husky || true",
```
```
.husky/pre-commit:  npx lint-staged
```

husky **never exits non-zero**. `bin.js` writes the return value of `index.js`
to stdout and sets no exit code:

```js
d = c => console.error(`husky - ${c} command is DEPRECATED`)
if (['add', 'set', 'uninstall'].includes(a)) { d(a); p.exit(1) }
if (a == 'install') d(a)

p.stdout.write(i(a == 'install' ? undefined : a))
```

and `index.js` returns a *message*, not a failure, for every problem it can
have:

```js
export default (d = '.husky') => {
	if (process.env.HUSKY === '0') return 'HUSKY=0 skip install'
	if (d.includes('..')) return '.. not allowed'
	if (!f.existsSync('.git')) return `.git can't be found`
	...
	if (s == null) return 'git command not found'
	if (s) return '' + e
```

So `npm install` prints one line of prose and reports success while
`core.hooksPath` is never set and **no hook is installed**. `|| true` in the
`prepare` script guarantees that stays true even if husky ever starts exiting
non-zero.

The failure mode this actually hits is the multi-language layout this template
already supports (see #141, "detect-code-changes.mjs ignore list never matches
in the multi-language (`js/`) layout"): when `package.json` lives in `js/` and
`.git` is at the repository root, `existsSync('.git')` is false and the hooks
silently do not exist. Contributors get no local gate, and nobody is told.

The `python` and `rust` templates both ship a `.pre-commit-config.yaml`; this
one is the only template with no working local gate for that layout.

## Reproducible example

```sh
W=$(mktemp -d); cd "$W"; git init -q .
mkdir js && cd js
npm init -y >/dev/null
npm i --no-audit --no-fund husky@9.1.7 >/dev/null
mkdir -p .husky && printf 'npx lint-staged\n' > .husky/pre-commit
./node_modules/.bin/husky; echo "exit=$?"
git config core.hooksPath || echo "(core.hooksPath unset)"
```

Observed:

```
.git can't be foundexit=0
(core.hooksPath unset)
```

Exit 0, no trailing newline, no hook, and under `npm install` that single line
scrolls past inside the install output. `git commit` then runs no checks at all.

## Workaround

Run husky from the repository root with the hook directory in the package:

```sh
cd .. && npx husky js/.husky
```

and verify by hand that `git config core.hooksPath` prints `js/.husky/_`. That
is a manual step nobody will repeat after a fresh clone, which is why it is a
workaround.

## Suggested fix in code

Two independent changes; the first is the small one, the second is the one that
matches the other two templates.

**1. Stop masking the install, and verify it.** Replace

```json
  "prepare": "husky || true",
```

with a script that fails when the hook is not actually installed:

```json
  "prepare": "node scripts/install-git-hooks.mjs"
```

```js
#!/usr/bin/env node
// husky exits 0 for every failure it has, including ".git can't be found".
// Verify the outcome instead of trusting the exit code.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (process.env.CI || process.env.HUSKY === '0') process.exit(0);
// A consumer installing this package as a dependency has no .git of its own.
if (!existsSync('../.git') && !existsSync('.git')) process.exit(0);

const message = execFileSync('npx', ['husky'], { encoding: 'utf8' }).trim();

// `git config --get` exits 1 when the key is unset, which is the case this
// script exists to catch, so the throw is the answer rather than an error.
let hooksPath = '';
try {
  hooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  hooksPath = '';
}

if (!hooksPath) {
  console.error(`git hooks were not installed: ${message || 'husky said nothing'}`);
  process.exit(1);
}
```

**2. Adopt `pre-commit`, as the python and rust templates already do.** It finds
the repository root itself, so the `js/` layout needs no special case, and the
same hooks then run in CI and locally from one declaration:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: eslint
        name: eslint
        entry: npx --prefix js eslint
        language: system
        files: ^js/.*\.(js|mjs|cjs)$
      - id: prettier
        name: prettier
        entry: npx --prefix js prettier --write
        language: system
        files: ^js/
```

Either way, the property worth having is the one absent today: **a hook install
that did not install anything must not report success.**

## Where this came from

Found while eliminating every false positive, false negative, warning and error
from the CI of a repository built from these templates
(link-foundation/browser-commander#81, PR link-foundation/browser-commander#82,
root cause RC-14). That repository has the `js/` layout, discovered its husky
hooks had never run, and replaced them with `pre-commit`.
