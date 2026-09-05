/**
 * Git tag namespaces for the three packages this repository releases.
 *
 * They used to share one: both the JS package and the Rust crate tagged
 * `v<version>`, and their versions overlap. `git tag` will not recreate an
 * existing tag, so the second language to reach a given number released
 * without a tag, and the tag that does exist points at the other language's
 * commit -- `v0.10.11` is a crates.io version sitting on the JS 0.17.0
 * release commit. Python had already solved this with a prefix; the prefixes
 * now live here so the three cannot drift back together.
 *
 * `js` keeps the bare `v` because 36 published tags already use it and
 * renaming them would break every existing release link.
 *
 * See dev/log/issues/83/pulls/84/analysis/root-causes.md, RC-D.
 */

/** @type {Readonly<Record<string, string>>} */
export const TAG_PREFIXES = Object.freeze({
  js: 'v',
  python: 'python-v',
  rust: 'rust-v',
});

/**
 * Build the release tag for a language.
 * @param {string} language - A key of TAG_PREFIXES.
 * @param {string} version - Version without any prefix, e.g. "0.10.11".
 * @returns {string}
 */
export function releaseTag(language, version) {
  const prefix = TAG_PREFIXES[language];
  if (prefix === undefined) {
    throw new Error(
      `Unknown release language "${language}"; expected one of ${Object.keys(
        TAG_PREFIXES
      ).join(', ')}`
    );
  }
  return `${prefix}${version}`;
}
