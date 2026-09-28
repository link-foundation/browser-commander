// Experiment (#104): what does a chromedriver-launched Chrome reveal, and does
// `excludeSwitches: ['enable-automation']` plus
// `--disable-blink-features=AutomationControlled` restore
// navigator.webdriver === false?
// Usage: xvfb-run -a node experiments/issue-104/webdriver-automation-flags.mjs
//        (HEADLESS=true for a headless run)
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const { Builder } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

const headless = process.env.HEADLESS === 'true';
const variants = {
  plain: { args: [], exclude: [] },
  excludeEnableAutomation: { args: [], exclude: ['enable-automation'] },
  disableAutomationControlled: {
    args: ['--disable-blink-features=AutomationControlled'],
    exclude: [],
  },
  both: {
    args: ['--disable-blink-features=AutomationControlled'],
    exclude: ['enable-automation'],
  },
  // A fixed, non-zero port is what the #101 real launch relies on.
  fixedPortExcludeEnableAutomation: {
    args: [`--remote-debugging-port=${await freePort()}`],
    exclude: ['enable-automation'],
  },
  // Every switch chromedriver adds on its own, excluded: only the fixed
  // debugging port it needs to attach remains.
  minimal: {
    args: [`--remote-debugging-port=${await freePort()}`],
    exclude: [
      'allow-pre-commit-input',
      'disable-background-networking',
      'disable-background-timer-throttling',
      'disable-backgrounding-occluded-windows',
      'disable-client-side-phishing-detection',
      'disable-default-apps',
      'disable-features',
      'disable-hang-monitor',
      'disable-popup-blocking',
      'disable-prompt-on-repost',
      'disable-sync',
      'enable-automation',
      'enable-logging',
      'log-level',
      'no-first-run',
      'no-service-autorun',
      'password-store',
      'test-type',
      'use-mock-keychain',
    ],
  },
};

async function freePort() {
  const net = await import('node:net');
  const server = net.createServer().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

for (const [name, variant] of Object.entries(variants)) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bc-wd-flags-'));
  const options = new chrome.Options();
  options.setChromeBinaryPath(
    process.env.CHROME_PATH ?? '/usr/bin/google-chrome'
  );
  options.addArguments(`--user-data-dir=${dir}`, ...variant.args);
  if (headless) {
    options.addArguments('--headless=new');
  }
  if (variant.exclude.length > 0) {
    options.excludeSwitches(...variant.exclude);
  }
  const driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(options)
    .build();
  try {
    await driver.get('chrome://version');
    const commandLine = await driver.executeScript(
      "return document.querySelector('#command_line')?.textContent ?? ''"
    );
    await driver.get('data:text/html,<p>x</p>');
    const webdriver = await driver.executeScript('return navigator.webdriver');
    console.log(
      JSON.stringify({
        variant: name,
        headless,
        webdriver,
        commandLine: commandLine
          .split(/\s+(?=--)/)
          .filter((part) => part.startsWith('--'))
          .filter((part) => !part.startsWith('--user-data-dir')),
      })
    );
  } finally {
    await driver.quit();
    await rm(dir, { recursive: true, force: true });
  }
}
