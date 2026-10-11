import { withDeadline } from '../traces/deadline.js';
import { isVisible } from '../elements/visibility.js';

async function dismissVisible({ page, engine, selector, timeout = 1000 }) {
  if (engine === 'playwright') {
    const matches = page.locator(selector);
    for (let index = 0; index < (await matches.count()); index++) {
      const target = matches.nth(index);
      if (await target.isVisible()) {
        await target.click({ timeout });
        return 'dismissed';
      }
    }
    return 'absent';
  }
  const matches = await page.$$(selector);
  try {
    for (const target of matches) {
      if (await isVisible({ page, engine, selector: target })) {
        await target.click({ timeout });
        return 'dismissed';
      }
    }
    return 'absent';
  } finally {
    await Promise.allSettled(
      matches.map(async (target) => await target.dispose?.())
    );
  }
}

/** Dismiss caller-named overlays; a failed dismissal never blocks an action. */
export async function dismissOverlays({
  page,
  engine,
  overlays = [],
  onDismiss,
}) {
  if (!Array.isArray(overlays)) {
    throw new TypeError('overlays must be an array');
  }
  const reports = [];
  for (const item of overlays) {
    const options = typeof item === 'string' ? { selector: item } : item;
    if (!options?.selector) {
      throw new TypeError('overlay requires selector');
    }
    const report = { selector: options.selector, status: 'absent' };
    try {
      report.status = await withDeadline(
        dismissVisible({ page, engine, ...options }),
        options.timeout || 1000,
        `overlay ${options.selector}`
      );
    } catch (error) {
      report.status = 'error';
      report.error = error;
    }
    reports.push(report);
    for (const callback of [options.onDismiss, onDismiss]) {
      try {
        await withDeadline(
          Promise.resolve(callback?.(report)),
          options.timeout || 1000,
          'overlay report'
        );
      } catch {
        // Reporting must not interrupt the caller's requested interaction.
      }
    }
  }
  return reports;
}
