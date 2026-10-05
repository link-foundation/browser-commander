import path from 'node:path';
import { physicalPath } from '../browser-profile-files.js';
import { browserFamily } from '../browser-sources.js';
import { assertDedicatedUserDataDir } from '../system-browser.js';
import { validateDomains } from './domains.js';

export function validateMigrationOptions({
  include,
  domains,
  targetBrowser,
  to,
  platform,
  homeDir,
  environment,
  classes,
}) {
  if (
    !Array.isArray(include) ||
    include.some((type) => !classes.includes(type))
  ) {
    throw new TypeError(
      `include must contain supported data classes: ${classes.join(', ')}`
    );
  }
  validateDomains(domains);
  if (targetBrowser && browserFamily(targetBrowser) !== 'chromium') {
    throw new TypeError(
      `Migration target ${targetBrowser} does not yet have a supported target file writer`
    );
  }
  assertDedicatedUserDataDir(to, { platform, homeDir, environment });
}

export function validateMigrationPaths(source, target) {
  const sourcePath = physicalPath(source);
  const targetPath = physicalPath(target);
  const within = (parent, child) =>
    child === parent || child.startsWith(`${parent}${path.sep}`);
  if (within(sourcePath, targetPath) || within(targetPath, sourcePath)) {
    throw new TypeError(
      'Migration source and target directories must not overlap'
    );
  }
}
