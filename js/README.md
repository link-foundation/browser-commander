# Browser Commander

A universal browser automation library for JavaScript/TypeScript that supports both Playwright and Puppeteer with a unified API. The key focus is on **stoppable page triggers** - ensuring automation logic is properly mounted/unmounted during page navigation.

## Installation

```bash
npm install browser-commander
```

You'll also need either Playwright or Puppeteer:

```bash
# With Playwright
npm install playwright

# Or with Puppeteer
npm install puppeteer
```

## Core Concept: Page State Machine

Browser Commander manages the browser as a state machine with two states:

```
+------------------+                      +------------------+
|                  |   navigation start   |                  |
|  WORKING STATE   | -------------------> |  LOADING STATE   |
|  (action runs)   |                      |  (wait only)     |
|                  |   <-----------------  |                  |
+------------------+     page ready       +------------------+
```

**LOADING STATE**: Page is loading. Only waiting/tracking operations are allowed. No automation logic runs.

**WORKING STATE**: Page is fully loaded (30 seconds of network idle). Page triggers can safely interact with DOM.

## Quick Start

```javascript
import {
  launchBrowser,
  makeBrowserCommander,
  makeUrlCondition,
} from 'browser-commander';

// 1. Launch browser
const { browser, page } = await launchBrowser({ engine: 'playwright' });

// 2. Create commander
const commander = makeBrowserCommander({ page, verbose: true });

// 3. Register page trigger with condition and action
commander.pageTrigger({
  name: 'example-trigger',
  condition: makeUrlCondition('*example.com*'), // matches URLs containing 'example.com'
  action: async (ctx) => {
    // ctx.commander has all methods, but they throw ActionStoppedError if navigation happens
    // ctx.checkStopped() - call in loops to check if should stop
    // ctx.abortSignal - use with fetch() for cancellation
    // ctx.onCleanup(fn) - register cleanup when action stops

    console.log(`Processing: ${ctx.url}`);

    // Safe iteration - stops if navigation detected
    await ctx.forEach(['item1', 'item2'], async (item) => {
      await ctx.commander.clickButton({ selector: `[data-id="${item}"]` });
    });
  },
});

// 4. Navigate - action auto-starts when page is ready
await commander.goto({ url: 'https://example.com' });

// 5. Cleanup
await commander.destroy();
await browser.close();
```

## URL Condition Helpers

The `makeUrlCondition` helper makes it easy to create URL matching conditions:

```javascript
import {
  makeUrlCondition,
  allConditions,
  anyCondition,
  notCondition,
} from 'browser-commander';

// Exact URL match
makeUrlCondition('https://example.com/page');

// Contains substring (use * wildcards)
makeUrlCondition('*checkout*'); // URL contains 'checkout'
makeUrlCondition('*example.com*'); // URL contains 'example.com'

// Starts with / ends with
makeUrlCondition('/api/*'); // starts with '/api/'
makeUrlCondition('*.json'); // ends with '.json'

// Express-style route patterns
makeUrlCondition('/vacancy/:id'); // matches /vacancy/123
makeUrlCondition('https://hh.ru/vacancy/:vacancyId'); // matches specific domain + path
makeUrlCondition('/user/:userId/profile'); // multiple segments

// RegExp
makeUrlCondition(/\/product\/\d+/);

// Custom function (receives full context)
makeUrlCondition((url, ctx) => {
  const parsed = new URL(url);
  return (
    parsed.pathname.startsWith('/admin') && parsed.searchParams.has('edit')
  );
});

// Combine conditions
allConditions(
  makeUrlCondition('*example.com*'),
  makeUrlCondition('*/checkout*')
); // Both must match

anyCondition(makeUrlCondition('*/cart*'), makeUrlCondition('*/checkout*')); // Either matches

notCondition(makeUrlCondition('*/admin*')); // Negation
```

## Page Trigger Lifecycle

### The Guarantee

When navigation is detected:

1. **Action is signaled to stop** (AbortController.abort())
2. **Wait for action to finish** (up to 10 seconds for graceful cleanup)
3. **Only then start waiting for page load**

This ensures:

- No DOM operations on stale/loading pages
- Actions can do proper cleanup (clear intervals, save state)
- No race conditions between action and navigation

## Action Context API

When your action is called, it receives a context object with these properties:

```javascript
commander.pageTrigger({
  name: 'my-trigger',
  condition: makeUrlCondition('*/checkout*'),
  action: async (ctx) => {
    // Current URL
    ctx.url; // 'https://example.com/checkout'

    // Trigger name (for debugging)
    ctx.triggerName; // 'my-trigger'

    // Check if action should stop
    ctx.isStopped(); // Returns true if navigation detected

    // Throw ActionStoppedError if stopped (use in manual loops)
    ctx.checkStopped();

    // AbortSignal - use with fetch() or other cancellable APIs
    ctx.abortSignal;

    // Safe wait (throws if stopped during wait)
    await ctx.wait(1000);

    // Safe iteration (checks stopped between items)
    await ctx.forEach(items, async (item) => {
      await ctx.commander.clickButton({ selector: item.selector });
    });

    // Register cleanup (runs when action stops)
    ctx.onCleanup(() => {
      console.log('Cleaning up...');
    });

    // Commander with all methods wrapped to throw on stop
    await ctx.commander.fillTextArea({ selector: 'input', text: 'hello' });

    // Raw commander (use carefully - does not auto-throw)
    ctx.rawCommander;
  },
});
```

## API Reference

### launchBrowser(options)

```javascript
const { browser, page } = await launchBrowser({
  engine: 'playwright', // 'playwright' or 'puppeteer'
  headless: false, // Run in headless mode
  userDataDir: '~/.hh-apply/playwright-data', // Browser profile directory
  slowMo: 150, // Slow down operations (ms)
  verbose: false, // Enable debug logging
  args: ['--no-sandbox', '--disable-setuid-sandbox'], // Custom Chrome args to append
});
```

The `args` option allows passing custom Chrome arguments, which is useful for headless server environments (Docker, CI/CD) that require flags like `--no-sandbox`.

The `colorScheme` option allows setting the initial color scheme (`'light'`, `'dark'`, or `'no-preference'`) at launch time for screenshot services and testing tools:

```javascript
const { browser, page } = await launchBrowser({
  engine: 'playwright',
  colorScheme: 'dark', // 'light', 'dark', or 'no-preference'
});
```

### commander.emulateMedia(options)

Emulate media features (e.g. `prefers-color-scheme`) for the current page:

```javascript
// Set dark mode
await commander.emulateMedia({ colorScheme: 'dark' });

// Set light mode
await commander.emulateMedia({ colorScheme: 'light' });

// Reset to system default
await commander.emulateMedia({ colorScheme: null });
```

Works with both Playwright (`page.emulateMedia`) and Puppeteer (`page.emulateMediaFeatures`). Can also be used as a standalone function:

```javascript
import { emulateMedia } from 'browser-commander';

await emulateMedia({ page, engine: 'playwright', colorScheme: 'dark' });
```

### makeBrowserCommander(options)

```javascript
const commander = makeBrowserCommander({
  page, // Required: Playwright/Puppeteer page
  verbose: false, // Enable debug logging
  enableNetworkTracking: true, // Track HTTP requests
  enableNavigationManager: true, // Enable navigation events
});
```

### commander.pageTrigger(config)

```javascript
const unregister = commander.pageTrigger({
  name: 'trigger-name',                    // For debugging
  condition: (ctx) => boolean,             // When to run (receives {url, commander})
  action: async (ctx) => void,             // What to do
  priority: 0,                             // Higher runs first
});
```

### commander.goto(options)

```javascript
await commander.goto({
  url: 'https://example.com',
  waitUntil: 'domcontentloaded', // Playwright/Puppeteer option
  timeout: 60000,
});
```

### commander.clickButton(options)

```javascript
await commander.clickButton({
  selector: 'button.submit',
  scrollIntoView: true,
  waitForNavigation: true,
});
```

### commander.fillTextArea(options)

```javascript
await commander.fillTextArea({
  selector: 'textarea.message',
  text: 'Hello world',
  checkEmpty: true,
});
```

### Keyboard Interactions

```javascript
import { pressKey, typeText, keyDown, keyUp } from 'browser-commander';

// Press a single key
await pressKey({ page, engine: 'playwright', key: 'Escape' });
await pressKey({ page, engine: 'playwright', key: 'Enter' });
await pressKey({ page, engine: 'playwright', key: 'Tab' });

// Type text
await typeText({ page, engine: 'playwright', text: 'Hello World' });

// Hold and release modifier keys
await keyDown({ page, engine: 'playwright', key: 'Control' });
await keyUp({ page, engine: 'playwright', key: 'Control' });
```

### commander.destroy()

```javascript
await commander.destroy(); // Stop actions, cleanup
```

## Best Practices

### 1. Use ctx.forEach for Loops

```javascript
// BAD: Won't stop on navigation
for (const item of items) {
  await ctx.commander.click({ selector: item });
}

// GOOD: Stops immediately on navigation
await ctx.forEach(items, async (item) => {
  await ctx.commander.click({ selector: item });
});
```

### 2. Use ctx.checkStopped for Complex Logic

```javascript
action: async (ctx) => {
  while (hasMorePages) {
    ctx.checkStopped(); // Throws if navigation detected

    await processPage(ctx);
    hasMorePages = await ctx.commander.isVisible({ selector: '.next' });
  }
};
```

### 3. Register Cleanup for Resources

```javascript
action: async (ctx) => {
  const intervalId = setInterval(updateStatus, 1000);

  ctx.onCleanup(() => {
    clearInterval(intervalId);
    console.log('Interval cleared');
  });

  // ... rest of action
};
```

### 4. Use ctx.abortSignal with Fetch

```javascript
action: async (ctx) => {
  const response = await fetch(url, {
    signal: ctx.abortSignal, // Cancels on navigation
  });
};
```

## Extensibility / Escape Hatch

`browser-commander` cannot anticipate every browser API. When you need an API that is not yet supported, you can access the raw underlying engine objects directly as an **official extensibility escape hatch**.

### Using `commander.page` for engine-specific APIs

`makeBrowserCommander` exposes `commander.page` — this is the **raw Playwright or Puppeteer page object**, not a wrapper. Use it directly for APIs browser-commander doesn't yet support:

```javascript
const { browser, page } = await launchBrowser({ engine: 'playwright' });
const commander = makeBrowserCommander({ page });

// Access engine-specific API via commander.page
// Example: PDF generation (issue #35)
const pdfBuffer = await commander.page.pdf({
  format: 'A4',
  printBackground: true,
  margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
});

// Example: Color scheme emulation (issue #36)
await commander.page.emulateMedia({ colorScheme: 'dark' });

// Example: Keyboard interactions (issue #37)
await commander.page.keyboard.press('Escape');

// Example: Dialog handling (issue #38)
commander.page.on('dialog', async (dialog) => {
  await dialog.dismiss();
});
```

### Using `launchBrowser` raw return values

`launchBrowser()` returns the raw `{ browser, page }` objects from the underlying engine. You can use these directly:

```javascript
const { browser, page } = await launchBrowser({ engine: 'playwright' });

// Use raw page directly for engine-specific APIs
await page.pdf({ format: 'A4' });

// Or create a commander for the unified API
const commander = makeBrowserCommander({ page });
```

### No more `_page` hacks

If you previously used `page._page || page` to access the raw page, replace it with `commander.page`:

```javascript
// BEFORE (fragile hack):
const rawPage = page._page || page;
await rawPage.pdf({ format: 'A4' });

// AFTER (official API):
await commander.page.pdf({ format: 'A4' });
```

This is the **official extensibility mechanism** while awaiting browser-commander to add first-class support for these APIs. Please [report missing APIs](https://github.com/link-foundation/browser-commander/issues) so they can be added.

## Debugging

Enable verbose mode for detailed logs:

```javascript
const commander = makeBrowserCommander({ page, verbose: true });
```

## Architecture

See [src/ARCHITECTURE.md](src/ARCHITECTURE.md) for detailed architecture documentation.

## License

[UNLICENSE](../LICENSE)
