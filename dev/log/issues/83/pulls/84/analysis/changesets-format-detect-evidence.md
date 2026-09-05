# Raw evidence: @changesets/format formatter auto-detection

Package: @changesets/format@0.1.2
Source: node_modules/@changesets/format/dist/index.js, installed fresh 2026-09-05T16:23:08Z

## The deno formatter entry
```js
	deno: {
		name: "deno",
		configFiles: [
			"deno.json",
			"deno.jsonc",
			{
				file: "deno.json",
				key: "fmt"
			}
		],
		async format(files, ctx) {
			await spawnProcess("deno", [
				"fmt",
				"--permit-no-files",
				...files
			], ctx.cwd);
		}
	},
```

## The detection order and the traversal
```js
//#endregion
//#region src/detect.ts
const defaultDetectOrder = Object.freeze([
	"dprint",
	"deno",
	"oxfmt",
	"biome",
	"prettier"
]);
/**
* Detect the preferred formatter used in the project.
*/
async function detect(options = {}) {
	const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
	const stopDir = options.stopDir ? path.resolve(cwd, options.stopDir) : void 0;
	const order = options.order ?? defaultDetectOrder;
	let found = traverseUpwards(cwd, stopDir, (dir) => {
		for (const formatterName of order) {
			const formatter = formatters[formatterName];
			for (const configFile of formatter.configFiles) if (typeof configFile === "string") {
				const configFilePath = path.join(dir, configFile);
				if (fs.existsSync(configFilePath)) return formatter.name;
			} else if (checkConfigFileWithKeyExists(path.join(dir, configFile.file), configFile.key)) return formatter.name;
		}
	});
	found ??= traverseUpwards(cwd, stopDir, (dir) => {
		for (const formatterName of order) {
			const formatter = formatters[formatterName];
```

## Why this repository trips it

Four facts from the source above, in order of how much each one matters:

1. `deno` is second in `defaultDetectOrder`; `prettier` is last. Deno wins any
   tie against the formatter this repository actually uses.

2. `deno.configFiles` contains the bare string `"deno.json"`. `detect()` returns
   on the first `fs.existsSync` hit, so the mere *existence* of the file selects
   the deno formatter regardless of its contents. `js/deno.json` here configures
   only `nodeModulesDir` and `test` — it says nothing about formatting.

3. The same list also contains `{ file: "deno.json", key: "fmt" }`, which is
   evidently the intended precise check: "does this project actually configure
   `deno fmt`?" That entry is unreachable, because the bare string earlier in
   the same array always matches first. This looks like the upstream defect.

4. `deno` is the only formatter in the table with **no `packageName`**.
   `prettier`, `biome`, `oxfmt` and `dprint` are all invoked through
   `packageManagerExecute` (`npx <packageName> …`) and are resolvable from
   `node_modules`; `deno` is invoked as `spawnProcess("deno", ["fmt", …])`,
   straight off `PATH`, with no fallback and no existence check. On a runner
   without Deno installed that is an unconditional `spawn deno ENOENT`.

Also note `detect()` uses `traverseUpwards`, so a `deno.json` in any *parent*
directory selects the deno formatter for a nested package too.
