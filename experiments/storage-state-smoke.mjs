import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { launchBrowser, saveStorageState } from "../js/src/index.js";

const [engine, browserExecutable] = process.argv.slice(2);
if (!["playwright", "puppeteer"].includes(engine) || !browserExecutable) {
  throw new Error(
    "Usage: node experiments/storage-state-smoke.mjs <playwright|puppeteer> <browser-executable>",
  );
}

const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), `browser-commander-${engine}-storage-state-`),
);
const firstProfile = path.join(temporaryDirectory, "first-profile");
const secondProfile = path.join(temporaryDirectory, "second-profile");
const storageStatePath = path.join(temporaryDirectory, "storage-state.json");
let firstBrowser;
let secondBrowser;

try {
  const first = await launchBrowser({
    engine,
    executablePath: browserExecutable,
    userDataDir: firstProfile,
    headless: true,
  });
  firstBrowser = first.browser;
  await first.page.goto("https://example.com");
  await first.page.evaluate(() =>
    globalThis.localStorage.setItem("theme", "dark"),
  );
  if (engine === "playwright") {
    await first.page
      .context()
      .addCookies([
        { name: "session", value: "saved", url: "https://example.com" },
      ]);
  } else {
    await first.page.setCookie({
      name: "session",
      value: "saved",
      url: "https://example.com",
    });
  }
  await saveStorageState(first.page, storageStatePath);
  await firstBrowser.close();
  firstBrowser = undefined;

  const second = await launchBrowser({
    engine,
    executablePath: browserExecutable,
    userDataDir: secondProfile,
    headless: true,
    storageState: storageStatePath,
  });
  secondBrowser = second.browser;
  await second.page.goto("https://example.com");

  assert.equal(
    await second.page.evaluate(() => globalThis.localStorage.getItem("theme")),
    "dark",
  );
  assert.match(
    await second.page.evaluate(() => document.cookie),
    /session=saved/,
  );
  console.log(`${engine} storage-state smoke test passed`);
} finally {
  await firstBrowser?.close();
  await secondBrowser?.close();
  await rm(temporaryDirectory, { recursive: true, force: true });
}
