// Which browser a default Selenium launch resolves to (issue #179).
// Usage: node experiments/issue-179/selenium-manager-cft.mjs
// With Google Chrome installed this still prints Chrome for Testing.
import {
  isChromeForTesting,
  resolveLaunchExecutable,
  seleniumManagerChromeForTesting,
} from '../../js/src/browser/launch-executable.js';

const managed = await seleniumManagerChromeForTesting();
console.log('Selenium Manager Chrome for Testing:', managed);
console.log('  is Chrome for Testing:', isChromeForTesting(managed));
const resolved = await resolveLaunchExecutable({ engine: 'selenium' });
console.log('Default selenium launch executable:', resolved);
console.log('  is Chrome for Testing:', isChromeForTesting(resolved));
