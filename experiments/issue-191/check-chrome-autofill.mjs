import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deriveChromiumCookieKey } from '../../js/src/browser/browser-cookie-crypto.js';
import { encryptChromiumValue } from '../../js/src/browser/migration/chromium-crypto.js';
import { launchRealBrowser } from '../../js/src/browser/real-browser.js';

// Run on Linux with Google Chrome and a display (for example, xvfb-run -a).
// Chrome creates the schema in a temporary profile. Seed only a throwaway
// login for a loopback server, then let Chrome fill the form for submission.
const username = 'fixture-user';
const password = 'fixture-password';
const server = createServer(async (request, response) => {
  if (request.method === 'POST') {
    let body = '';
    for await (const chunk of request) body += chunk;
    const form = new URLSearchParams(body);
    const matched =
      form.get('username') === username && form.get('password') === password;
    response.end(matched ? 'Autofilled sign-in accepted' : 'Sign-in rejected');
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><title>Autofill smoke check</title>
    <h1>Sign in</h1>
    <form method="post">
      <label>Username <input name="username" autocomplete="username"></label>
      <label>Password <input name="password" type="password" autocomplete="current-password"></label>
      <button>Sign in</button>
    </form>`);
});

function seedLogin(userDataDir, url) {
  const database = new DatabaseSync(
    path.join(userDataDir, 'Default', 'Login Data')
  );
  try {
    const key = deriveChromiumCookieKey('peanuts', 'linux');
    const encrypted = encryptChromiumValue({
      plaintext: password,
      key,
      platform: 'linux',
    });
    // Chrome uses microseconds since 1601-01-01 UTC.
    const timestamp = (BigInt(Date.now()) + 11644473600000n) * 1000n;
    database
      .prepare(
        `
      INSERT INTO logins (
        origin_url, action_url, username_element, username_value, password_element,
        password_value, submit_element, signon_realm, date_created,
        blacklisted_by_user, scheme, password_type, times_used, date_last_used
      ) VALUES (?, ?, 'username', ?, 'password', ?, '', ?, ?, 0, 0, 0, 1, ?)
      `
      )
      .run(url, url, username, encrypted, url, timestamp, timestamp);
  } finally {
    database.close();
  }
}

const userDataDir = await mkdtemp(
  path.join(tmpdir(), 'bc-no-promos-autofill-')
);
let session;
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/`;
  const launch = () =>
    launchRealBrowser({
      channel: 'chrome',
      restrictions: ['no-promos', 'basic-password-store'],
      userDataDir,
    });

  session = await launch();
  await session.page.goto(url);
  await session.close();
  session = undefined;
  seedLogin(userDataDir, url);

  session = await launch();
  const { page } = session;
  await page.goto(url);
  // A real click lets Chrome reveal the filled password to the page.
  await page.getByRole('heading', { name: 'Sign in' }).click();
  await page.waitForFunction(
    () => document.querySelector('input[type=password]').value.length > 0,
    undefined,
    { timeout: 5000 }
  );
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page
    .getByText('Autofilled sign-in accepted')
    .waitFor({ timeout: 5000 });
  console.log(
    'Chrome submitted the saved fixture login with no-promos enabled.'
  );
} finally {
  await session?.close();
  server.close();
  await rm(userDataDir, { recursive: true, force: true });
}
