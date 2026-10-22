// Print the Chrome for Testing each engine starts by default (issue #179), and
// fail when one is missing or is not Chrome for Testing.
import {
  isChromeForTesting,
  resolveLaunchExecutable,
} from '../../js/src/browser/launch-executable.js';

let missing = false;
for (const engine of ['playwright', 'puppeteer', 'selenium']) {
  try {
    const executable = await resolveLaunchExecutable({ engine });
    if (!isChromeForTesting(executable)) {
      throw new Error(`${executable} is not Chrome for Testing`);
    }
    console.log(`${engine}: ${executable}`);
  } catch (error) {
    missing = true;
    console.error(`${engine}: ${error.message}`);
  }
}
process.exitCode = missing ? 1 : 0;
