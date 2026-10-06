// Issue #128: CodeQL js/polynomial-redos on the Playwright text selector
// regexes. Times the old regexes on inputs that never match.
// Run: node experiments/issue-128/text-selector-redos.mjs
const patterns = {
  hasText: /^(.+?):has-text\("(.+?)"\)$/,
  textIs: /^(.+?):text-is\("(.+?)"\)$/,
};
for (const n of [2_000, 4_000, 8_000, 16_000]) {
  const input = `a${':has-text("'.repeat(n)}`;
  for (const [name, re] of Object.entries(patterns)) {
    const start = process.hrtime.bigint();
    re.test(input);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`${name}\tlength=${input.length}\t${ms.toFixed(1)} ms`);
  }
}
