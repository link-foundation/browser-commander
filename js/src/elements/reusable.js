import { count, isVisible } from './visibility.js';
import { getLocatorOrElement } from './locators.js';
import { clickButton } from '../interactions/click.js';
import { evaluate } from '../utilities/wait.js';

/** Return the first selector in caller order with a match (optionally visible). */
export async function findFirst({
  selectors,
  visible = false,
  ...options
} = {}) {
  if (!Array.isArray(selectors)) {
    throw new TypeError('selectors must be an array');
  }
  for (const selector of selectors) {
    if (
      (await count({ ...options, selector })) > 0 &&
      (!visible || (await isVisible({ ...options, selector })))
    ) {
      return selector;
    }
  }
  return null;
}

/** Match any phrase in body text; Unicode whitespace includes nonbreaking spaces. */
export function hasText({
  texts,
  normalizeWhitespace = false,
  ...options
} = {}) {
  if (!Array.isArray(texts) || texts.some((text) => typeof text !== 'string')) {
    throw new TypeError('texts must be strings');
  }
  return evaluate({
    ...options,
    fn: (phrases, normalize) => {
      const clean = (text) =>
        normalize ? text.replace(/\s+/gu, ' ').trim() : text;
      const body = clean(document.body?.textContent ?? '');
      return phrases.some((text) => body.includes(clean(text)));
    },
    args: [texts, normalizeWhitespace],
  });
}

/** Observe checked state of the selected checkbox or radio. */
export async function isChecked(options = {}) {
  const element = await getLocatorOrElement(options);
  if (!element) {
    return false;
  }
  const probe = (el) => Boolean(el.checked);
  return options.engine === 'playwright'
    ? element.evaluate(probe)
    : options.page.evaluate(probe, element);
}

/** Idempotently set a checkbox or radio and verify the resulting state. */
export async function check({ checked = true, ...options } = {}) {
  const element = await getLocatorOrElement(options);
  if (!element) {
    return { checked: false, changed: false, verified: false };
  }
  const type =
    options.engine === 'playwright'
      ? await element.evaluate((el) => el.type)
      : await options.page.evaluate((el) => el.type, element);
  if (!['checkbox', 'radio'].includes(type)) {
    throw new TypeError('check requires a checkbox or radio');
  }
  if (type === 'radio' && !checked) {
    throw new TypeError('A radio cannot be unchecked by clicking');
  }
  const before = await isChecked({ ...options, selector: element });
  if (before === checked) {
    return { checked: before, changed: false, verified: true };
  }
  await clickButton({
    ...options,
    selector: element,
    verify: false,
    waitAfterClick: 0,
    waitForNavigation: false,
  });
  const after = await isChecked({ ...options, selector: element });
  return {
    checked: after,
    changed: before !== after,
    verified: after === checked,
  };
}
