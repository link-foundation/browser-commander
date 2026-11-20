import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchRealBrowser } from '../../js/src/browser/real-browser.js';

// Run with node experiments/issue-191/check-chrome-preferences.mjs using an
// installed Google Chrome and a display (for example, xvfb-run -a on Linux).
const userDataDir = await mkdtemp(path.join(tmpdir(), 'bc-no-promos-'));
const file = path.join(userDataDir, 'Default', 'Preferences');
try {
  await mkdir(path.dirname(file));
  await writeFile(
    file,
    JSON.stringify({
      credentials_enable_service: true,
      profile: { password_manager_enabled: true },
    })
  );
  const session = await launchRealBrowser({
    channel: 'chrome',
    restrictions: ['no-promos'],
    userDataDir,
  });
  try {
    assert.ok(
      session.args.includes(
        '--disable-features=ChromeWhatsNewUI,PromotionalTabs'
      )
    );
    await session.page.goto('chrome://version');
    console.log(await session.page.locator('#version').innerText());
  } finally {
    await session.close();
  }
  const preferences = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(preferences.browser.split_view_drag_and_drop_enabled, false);
  assert.equal(preferences.credentials_enable_service, true);
  assert.equal(preferences.profile.password_manager_enabled, true);
  console.log(
    'Split-view drag-and-drop was disabled and both password settings stayed enabled.'
  );
} finally {
  await rm(userDataDir, { recursive: true, force: true });
}
