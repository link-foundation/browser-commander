# Browser Commander

A universal browser automation library that supports both Playwright and Puppeteer with a unified API. The key focus is on **stoppable page triggers** - ensuring automation logic is properly mounted/unmounted during page navigation.

## Core Concept: Page State Machine

Browser Commander manages the browser as a state machine with two states:

```
┌─────────────────┐                      ┌─────────────────┐
│                 │   navigation start   │                 │
│  WORKING STATE  │ ─────────────────►   │  LOADING STATE  │
│  (action runs)  │                      │  (wait only)    │
│                 │   ◄─────────────────  │                 │
└─────────────────┘     page ready       └─────────────────┘
```

**LOADING STATE**: Page is loading. Only waiting/tracking operations are allowed. No automation logic runs.

**WORKING STATE**: Page is fully loaded (30 seconds of network idle). Page triggers can safely interact with DOM.

## Quick Start

```javascript
import {
  launchBrowser,
  makeBrowserCommander,
  makeUrlCondition,
} from './browser-commander/index.js';

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
} from './browser-commander/index.js';

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

### Lifecycle Flow

```
URL Change Detected
       │
       ▼
┌──────────────────────────────────┐
│ 1. Signal action to stop         │  ◄── AbortController.abort()
│ 2. Wait for action to finish     │  ◄── Max 10 seconds
│ 3. Run cleanup callbacks         │  ◄── ctx.onCleanup()
└──────────────────────────────────┘
       │
       ▼
   LOADING STATE
       │
       ▼
┌──────────────────────────────────┐
│ 1. Wait for URL stabilization    │  ◄── No more redirects (1s)
│ 2. Wait for network idle         │  ◄── 30 seconds no requests
└──────────────────────────────────┘
       │
       ▼
   WORKING STATE
       │
       ▼
┌──────────────────────────────────┐
│ 1. Find matching trigger         │  ◄── condition(ctx)
│ 2. Start action                  │  ◄── action(ctx)
└──────────────────────────────────┘
```

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

## ActionStoppedError

When navigation is detected, all `ctx.commander` methods throw `ActionStoppedError`:

```javascript
action: async (ctx) => {
  try {
    await ctx.commander.clickButton({ selector: 'button' });
  } catch (error) {
    if (commander.isActionStoppedError(error)) {
      // Navigation happened - clean up and return
      console.log('Navigation detected, stopping');
      return;
    }
    throw error; // Re-throw other errors
  }
};
```

The error is automatically caught by the PageTriggerManager, so you usually don't need to catch it unless you need custom cleanup logic.

## Condition Function

The `condition` function determines when your trigger runs. It receives full context:

```javascript
// Simple URL check
condition: (ctx) => ctx.url.includes('/checkout');

// Multiple pages
condition: (ctx) => ctx.url.includes('/cart') || ctx.url.includes('/checkout');

// Regex
condition: (ctx) => /\/product\/\d+/.test(ctx.url);

// Complex logic with commander access
condition: (ctx) => {
  const parsed = new URL(ctx.url);
  return (
    parsed.pathname.startsWith('/admin') && parsed.searchParams.has('edit')
  );
};

// Or use makeUrlCondition helper
condition: makeUrlCondition('/checkout/*');
```

### Trigger Priority

If multiple triggers match, the highest priority runs:

```javascript
// Higher priority runs first
commander.pageTrigger({
  name: 'specific-checkout',
  priority: 10, // Higher priority
  condition: makeUrlCondition('*/checkout/payment*'),
  action: handlePaymentPage,
});

commander.pageTrigger({
  name: 'general-checkout',
  priority: 0, // Default priority
  condition: makeUrlCondition('*/checkout*'),
  action: handleCheckoutPage,
});
```

## Returning to a Page

If navigation brings you back to a matching URL, the action restarts:

```javascript
// Trigger registered for /search
commander.pageTrigger({
  condition: makeUrlCondition('*/search*'),
  action: async (ctx) => {
    console.log('Search action started');
    // ... do work
  },
});

// Navigate to search -> action starts
await commander.goto({ url: '/search' });

// Navigate away -> action stops
await commander.goto({ url: '/product/123' });

// Navigate back -> action restarts (new instance)
await commander.goto({ url: '/search' });
```

## Unregistering Triggers

`pageTrigger` returns an unregister function:

```javascript
const unregister = commander.pageTrigger({
  name: 'temp-trigger',
  condition: makeUrlCondition('*/temp*'),
  action: async (ctx) => {
    /* ... */
  },
});

// Later: remove the trigger
unregister();
```

## Architecture

### File Structure

```
browser-commander/
├── index.js                    # Main entry, makeBrowserCommander()
├── core/
│   ├── page-trigger-manager.js # Trigger lifecycle management
│   ├── navigation-manager.js   # URL changes, abort signals
│   ├── network-tracker.js      # HTTP request tracking
│   ├── page-session.js         # Per-page context (legacy)
│   ├── navigation-safety.js    # Handle navigation errors
│   ├── constants.js            # CHROME_ARGS, TIMING
│   ├── logger.js               # Logging utilities
│   ├── engine-detection.js     # Detect Playwright/Puppeteer
│   └── preferences.js          # Chrome preferences
├── browser/
│   ├── launcher.js             # Browser launch
│   └── navigation.js           # goto, waitForNavigation
├── elements/
│   ├── locators.js             # Element location
│   ├── selectors.js            # querySelector, findByText
│   ├── visibility.js           # isVisible, isEnabled
│   └── content.js              # textContent, getAttribute
├── interactions/
│   ├── click.js                # clickButton, clickElement
│   ├── fill.js                 # fillTextArea
│   ├── keyboard.js             # pressKey, typeText, keyDown, keyUp
│   └── scroll.js               # scrollIntoView
├── utilities/
│   ├── wait.js                 # wait(), evaluate()
│   └── url.js                  # getUrl
└── high-level/
    └── universal-logic.js      # High-level utilities
```

### Component Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                      BrowserCommander                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐  │
│  │ NetworkTracker  │  │NavigationManager│  │PageTriggerMgr  │  │
│  │                 │  │                 │  │                │  │
│  │ - Track HTTP    │◄─│ - URL changes   │◄─│ - Register     │  │
│  │ - Wait idle     │  │ - Abort signals │  │ - Start/Stop   │  │
│  │ - 30s threshold │  │ - Events        │  │ - Lifecycle    │  │
│  └─────────────────┘  └─────────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Network Idle Detection

The library waits for **30 seconds of zero pending HTTP requests** before considering a page fully loaded:

```javascript
// NetworkTracker created with 30s idle timeout
networkTracker = createNetworkTracker({
  idleTimeout: 30000, // 30 seconds without requests = idle
});
```

This ensures:

- All lazy-loaded content is fetched
- All analytics scripts complete
- All async JavaScript executes
- SPAs fully hydrate

## API Reference

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

### commander.keyboard

Page-level keyboard input, independent of any specific element. Useful for
dismissing dialogs, submitting forms via Enter, tab navigation, etc.

```javascript
// Press a key (e.g. dismiss a modal)
await commander.keyboard.press('Escape');

// Type text at the page level (sent to the currently focused element)
await commander.keyboard.type('Hello World');

// Modifier key combinations
await commander.keyboard.down('Control');
await commander.keyboard.press('a');   // Select All
await commander.keyboard.up('Control');
```

Also available as flat functions:

```javascript
await commander.pressKey({ key: 'Enter' });
await commander.typeText({ text: 'some text' });
await commander.keyDown({ key: 'Shift' });
await commander.keyUp({ key: 'Shift' });
```

Key names follow the [Playwright keyboard convention](https://playwright.dev/docs/api/class-keyboard#keyboard-press):
`'Escape'`, `'Enter'`, `'Tab'`, `'ArrowUp'`, `'ArrowDown'`, `'Control'`, `'Shift'`, `'Alt'`, etc.

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

## Debugging

Enable verbose mode for detailed logs:

```javascript
const commander = makeBrowserCommander({ page, verbose: true });
```

Log symbols:

- `📋` Trigger registration/lifecycle
- `🚀` Action starting
- `🛑` Action stopping
- `✅` Action completed
- `❌` Action error
- `📤` Request started
- `📥` Request ended
- `🔗` URL change
- `🌐` Network idle
