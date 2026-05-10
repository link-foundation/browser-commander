import readline from "node:readline";

let engineName = null;
let browser = null;
let context = null;
let page = null;
let verbose = false;

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

function log(message) {
  if (verbose) {
    console.error(`[browser-commander:${engineName ?? "bridge"}] ${message}`);
  }
}

function serializeResult(value) {
  return value === undefined ? null : value;
}

function compactObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== null && entryValue !== undefined)
    .map(([key, entryValue]) => [key, compactObject(entryValue)])
    .filter(([, entryValue]) => {
      return (
        !entryValue ||
        typeof entryValue !== "object" ||
        Array.isArray(entryValue) ||
        Object.keys(entryValue).length > 0
      );
    });

  return Object.fromEntries(entries);
}

function send(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function ensurePage() {
  if (!page) {
    throw new Error("Browser page is not initialized. Send launch first.");
  }
  return page;
}

function chromeArgs(params) {
  const args = [...(params.args ?? [])];
  if (params.sandbox === false) {
    for (const flag of ["--no-sandbox", "--disable-setuid-sandbox"]) {
      if (!args.includes(flag)) {
        args.push(flag);
      }
    }
  }
  return args;
}

function elementInfo(selector) {
  const el = document.querySelector(selector);
  if (!el) {
    return null;
  }

  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  const isVisible =
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    rect.width > 0 &&
    rect.height > 0;

  return {
    tagName: el.tagName,
    textContent: el.textContent,
    isVisible,
    isEnabled: !el.disabled,
    boundingBox: isVisible ? [rect.x, rect.y, rect.width, rect.height] : null,
  };
}

async function launchPlaywright(params) {
  const { chromium } = await import("playwright");
  const contextOptions = {
    headless: params.headless,
    slowMo: params.slowMo,
    chromiumSandbox: params.sandbox !== false,
    viewport: null,
    args: chromeArgs(params),
    ignoreDefaultArgs: ["--enable-automation"],
  };

  if (params.colorScheme !== null && params.colorScheme !== undefined) {
    contextOptions.colorScheme = params.colorScheme;
  }

  context = await chromium.launchPersistentContext(
    params.userDataDir,
    contextOptions,
  );
  const pages = context.pages();
  page = pages[0] ?? (await context.newPage());
  browser = context;
}

async function launchPuppeteer(params) {
  const puppeteer = await import("puppeteer");
  browser = await puppeteer.default.launch({
    headless: params.headless,
    slowMo: params.slowMo,
    defaultViewport: null,
    args: ["--start-maximized", ...chromeArgs(params)],
    userDataDir: params.userDataDir,
  });
  const pages = await browser.pages();
  page = pages[0] ?? (await browser.newPage());

  if (params.colorScheme !== null && params.colorScheme !== undefined) {
    await applyColorScheme(params.colorScheme);
  }
}

async function applyColorScheme(colorScheme) {
  const currentPage = ensurePage();
  if (engineName === "playwright") {
    await currentPage.emulateMedia({ colorScheme });
  } else {
    await currentPage.emulateMediaFeatures(
      colorScheme === null
        ? []
        : [{ name: "prefers-color-scheme", value: colorScheme }],
    );
  }
}

async function handleLaunch(params) {
  engineName = params.engine;
  verbose = Boolean(params.verbose);

  process.env.GOOGLE_API_KEY = "no";
  process.env.GOOGLE_DEFAULT_CLIENT_ID = "no";
  process.env.GOOGLE_DEFAULT_CLIENT_SECRET = "no";

  if (engineName === "playwright") {
    await launchPlaywright(params);
  } else if (engineName === "puppeteer") {
    await launchPuppeteer(params);
  } else {
    throw new Error(`Unsupported bridge engine: ${engineName}`);
  }

  try {
    await page.bringToFront();
  } catch (error) {
    log(`bringToFront failed: ${error.message}`);
  }

  return { engine: engineName };
}

async function handleCommand(method, params) {
  switch (method) {
    case "launch":
      return await handleLaunch(params);
    case "close":
      if (browser) {
        await browser.close();
      }
      return null;
    case "url":
      return ensurePage().url();
    case "goto":
      await ensurePage().goto(params.url, { waitUntil: "load" });
      return null;
    case "querySelector":
      return await ensurePage().evaluate(elementInfo, params.selector);
    case "querySelectorAll":
      return await ensurePage().evaluate((selector) => {
        return Array.from(document.querySelectorAll(selector), (el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const isVisible =
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0;

          return {
            tagName: el.tagName,
            textContent: el.textContent,
            isVisible,
            isEnabled: !el.disabled,
            boundingBox: isVisible
              ? [rect.x, rect.y, rect.width, rect.height]
              : null,
          };
        });
      }, params.selector);
    case "count":
      return await ensurePage().evaluate(
        (selector) => document.querySelectorAll(selector).length,
        params.selector,
      );
    case "click":
      await ensurePage().click(params.selector);
      return null;
    case "fill":
      if (engineName === "playwright") {
        await ensurePage().fill(params.selector, params.text);
      } else {
        await ensurePage().$eval(
          params.selector,
          (el, text) => {
            el.value = text;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          },
          params.text,
        );
      }
      return null;
    case "typeText":
      await ensurePage().focus(params.selector);
      await ensurePage().keyboard.type(params.text);
      return null;
    case "textContent":
      return await ensurePage().evaluate((selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent : null;
      }, params.selector);
    case "inputValue":
      return await ensurePage().evaluate((selector) => {
        const el = document.querySelector(selector);
        return el && "value" in el ? el.value : null;
      }, params.selector);
    case "getAttribute":
      return await ensurePage().evaluate(
        ({ selector, attribute }) => {
          const el = document.querySelector(selector);
          return el ? el.getAttribute(attribute) : null;
        },
        { selector: params.selector, attribute: params.attribute },
      );
    case "isVisible":
      return Boolean(
        (await ensurePage().evaluate(elementInfo, params.selector))?.isVisible,
      );
    case "isEnabled":
      return await ensurePage().evaluate((selector) => {
        const el = document.querySelector(selector);
        return el ? !el.disabled : false;
      }, params.selector);
    case "waitForSelector":
      if (engineName === "playwright") {
        await ensurePage().waitForSelector(params.selector, {
          state: "visible",
          timeout: params.timeoutMs,
        });
      } else {
        await ensurePage().waitForSelector(params.selector, {
          visible: true,
          timeout: params.timeoutMs,
        });
      }
      return null;
    case "scrollIntoView":
      await ensurePage().evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) {
          throw new Error(`Element not found: ${selector}`);
        }
        el.scrollIntoView({ block: "center", inline: "center" });
      }, params.selector);
      return null;
    case "evaluate":
      return serializeResult(await ensurePage().evaluate(params.script));
    case "screenshot":
      return Buffer.from(await ensurePage().screenshot()).toString("base64");
    case "pdf":
      return Buffer.from(
        await ensurePage().pdf(compactObject(params)),
      ).toString("base64");
    case "bringToFront":
      await ensurePage().bringToFront();
      return null;
    case "waitForNavigation":
      if (engineName === "playwright") {
        await ensurePage().waitForLoadState("load", {
          timeout: params.timeoutMs,
        });
      } else {
        await ensurePage().waitForNavigation({
          timeout: params.timeoutMs,
          waitUntil: "load",
        });
      }
      return null;
    case "keyboardPress":
      await ensurePage().keyboard.press(params.key);
      return null;
    case "keyboardType":
      await ensurePage().keyboard.type(params.text);
      return null;
    case "keyboardDown":
      await ensurePage().keyboard.down(params.key);
      return null;
    case "keyboardUp":
      await ensurePage().keyboard.up(params.key);
      return null;
    default:
      throw new Error(`Unknown bridge method: ${method}`);
  }
}

rl.on("line", async (line) => {
  let request;
  try {
    request = JSON.parse(line);
    const result = await handleCommand(request.method, request.params ?? {});
    send({ id: request.id, ok: true, result: serializeResult(result) });
  } catch (error) {
    send({
      id: request?.id ?? 0,
      ok: false,
      error: error?.stack ?? error?.message ?? String(error),
    });
  }
});

process.on("SIGTERM", async () => {
  try {
    if (browser) {
      await browser.close();
    }
  } finally {
    process.exit(0);
  }
});
