/**
 * Named, opt-in launch restrictions (issue #103).
 *
 * By default Browser Commander starts Chrome exactly like a person would:
 * `--user-data-dir=<fresh profile> --remote-debugging-port=<reserved port>`
 * and nothing else. Every switch the library used to add on its own - and
 * every switch an automation engine adds - is available here by name, so a
 * caller who wants one asks for it and the difference from a hand-started
 * Chrome stays visible in their code:
 *
 *     launchBrowser({ restrictions: ['no-extensions', 'no-sync'] });
 *
 * The catalogue lives in `launch-restrictions.json`; Python and Rust ship
 * byte-identical copies, checked by `scripts/check-shared-fingerprint-assets.sh`.
 */
import { readFileSync } from 'node:fs';

const catalogue = JSON.parse(
  readFileSync(new URL('./launch-restrictions.json', import.meta.url), 'utf8')
);

/**
 * @typedef {object} LaunchRestriction
 * @property {string} id Stable name used in `restrictions`.
 * @property {string} description What it changes compared with a hand-started browser.
 * @property {string[]} [args] Chrome switches.
 * @property {string[]} [disableFeatures] Values merged into one `--disable-features` switch.
 * @property {Object<string,string>} [env] Environment for the browser process only.
 */

/** @type {ReadonlyArray<LaunchRestriction>} */
export const LAUNCH_RESTRICTIONS = Object.freeze(
  catalogue.restrictions.map((restriction) => Object.freeze(restriction))
);

/** Named groups of restrictions, such as the pre-#103 defaults. */
export const LAUNCH_RESTRICTION_PRESETS = Object.freeze(
  Object.fromEntries(
    Object.entries(catalogue.presets).map(([name, ids]) => [
      name,
      Object.freeze([...ids]),
    ])
  )
);

/**
 * Throw unless `value` is an array of strings.
 *
 * @param {unknown} value
 * @param {string} name - Option name used in the error
 * @returns {string[]}
 */
export function assertStringArray(value, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${name} must be an array of strings`);
  }
  return value;
}

function expand(names) {
  assertStringArray(names, 'restrictions');
  const ids = [];
  for (const name of names) {
    const preset = LAUNCH_RESTRICTION_PRESETS[name];
    ids.push(...(preset ?? [name]));
  }
  return [...new Set(ids)];
}

/**
 * Resolve restriction names (and preset names) into switches and environment.
 *
 * @param {string[]} [names]
 * @returns {{ids: string[], args: string[], env: Object<string,string>}}
 */
export function resolveRestrictions(names = []) {
  const ids = expand(names);
  const args = [];
  const disableFeatures = [];
  const env = {};
  for (const id of ids) {
    const restriction = LAUNCH_RESTRICTIONS.find((entry) => entry.id === id);
    if (!restriction) {
      throw new RangeError(
        `Unknown launch restriction "${id}". Expected one of ${[
          ...LAUNCH_RESTRICTIONS.map((entry) => entry.id),
          ...Object.keys(LAUNCH_RESTRICTION_PRESETS),
        ].join(', ')}`
      );
    }
    args.push(...(restriction.args ?? []));
    disableFeatures.push(...(restriction.disableFeatures ?? []));
    Object.assign(env, restriction.env ?? {});
  }
  if (disableFeatures.length > 0) {
    args.push(`--disable-features=${disableFeatures.join(',')}`);
  }
  return { ids, args, env };
}

const LIST_SWITCHES = [
  '--disable-features',
  '--enable-features',
  '--disable-blink-features',
  '--enable-blink-features',
];

function listSwitchOf(argument) {
  return LIST_SWITCHES.find((prefix) => argument.startsWith(`${prefix}=`));
}

/**
 * Merge repeated feature-list switches into one occurrence each.
 *
 * Chrome keeps only the last `--disable-features` (and friends), so two
 * sources that each add one would silently cancel each other. The merged
 * switch takes the place of the first occurrence.
 *
 * @param {string[]} args
 * @returns {string[]}
 */
export function mergeFeatureSwitches(args) {
  const values = new Map();
  for (const argument of args) {
    const name = listSwitchOf(argument);
    if (name) {
      const list = values.get(name) ?? [];
      for (const feature of argument.slice(name.length + 1).split(',')) {
        if (feature && !list.includes(feature)) {
          list.push(feature);
        }
      }
      values.set(name, list);
    }
  }
  const emitted = new Set();
  const merged = [];
  for (const argument of args) {
    const name = listSwitchOf(argument);
    if (!name) {
      merged.push(argument);
    } else if (!emitted.has(name)) {
      emitted.add(name);
      merged.push(`${name}=${values.get(name).join(',')}`);
    }
  }
  return merged;
}
