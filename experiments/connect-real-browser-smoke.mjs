import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import {
  launchAndConnectRealBrowser,
  makeBrowserCommander,
} from "../js/src/index.js";

const browserExecutable = process.argv[2];
if (!browserExecutable) {
  throw new Error(
    "Usage: node experiments/connect-real-browser-smoke.mjs <browser-executable>",
  );
}

const server = createServer((request, response) => {
  response.setHeader("content-type", "text/html");
  response.end('<main id="connected">CDP connection works</main>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const origin = `http://127.0.0.1:${port}`;
const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), "browser-commander-cdp-connect-"),
);

async function waitForExit(browserProcess) {
  if (browserProcess.exitCode !== null) return;
  await new Promise((resolve) => {
    browserProcess.once("exit", resolve);
    if (browserProcess.exitCode !== null) resolve();
  });
}

try {
  for (const engine of ["playwright", "puppeteer"]) {
    const connection = await launchAndConnectRealBrowser({
      engine,
      executablePath: browserExecutable,
      userDataDir: path.join(temporaryDirectory, engine),
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      seedCookies: [
        {
          name: "attached",
          value: engine,
          url: origin,
        },
      ],
    });

    try {
      await connection.page.goto(origin);
      const commander = makeBrowserCommander({
        page: connection.page,
        enableNetworkTracking: false,
        enableNavigationManager: false,
        enableDialogManager: false,
      });
      assert.equal(await commander.count({ selector: "#connected" }), 1);
      await commander.destroy();
      assert.match(
        await connection.page.evaluate(() => document.cookie),
        new RegExp(`attached=${engine}`),
      );
      console.log(`${engine} real-browser CDP smoke test passed`);
    } finally {
      await connection.browser.close();
      if (connection.browserProcess.exitCode === null) {
        connection.browserProcess.kill();
      }
      await waitForExit(connection.browserProcess);
    }
  }
} finally {
  server.close();
  await rm(temporaryDirectory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
