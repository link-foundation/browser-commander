# Browser Commander - Architecture

A universal browser automation library that supports both Playwright and Puppeteer with a unified API.

## Core Concept

Browser Commander models browser automation as a **state machine** with page triggers that automatically start/stop based on URL conditions.

```
┌─────────────────┐                      ┌─────────────────┐
│                 │   navigation start   │                 │
│  WORKING STATE  │ ─────────────────►   │  LOADING STATE  │
│  (action runs)  │                      │  (wait only)    │
│                 │   ◄─────────────────  │                 │
└─────────────────┘     page ready       └─────────────────┘
```

## Directory Structure

```
browser-commander/
├── index.js                    # Main entry, exports, makeBrowserCommander()
├── ARCHITECTURE.md             # This file
├── README.md                   # API documentation and usage guide
│
├── core/                       # Core infrastructure
│   ├── page-trigger-manager.js # Trigger lifecycle management
│   ├── navigation-manager.js   # URL changes, abort signals
│   ├── network-tracker.js      # HTTP request tracking
│   ├── page-session.js         # Per-page context (legacy)
│   ├── navigation-safety.js    # Handle navigation errors
│   ├── constants.js            # CHROME_ARGS, TIMING
│   ├── logger.js               # Logging utilities
│   ├── engine-detection.js     # Detect Playwright/Puppeteer
│   └── preferences.js          # Chrome preferences
│
├── browser/                    # Browser lifecycle
│   ├── launcher.js             # Browser launch (launchBrowser)
│   └── navigation.js           # goto, waitForNavigation
│
├── elements/                   # Element operations
│   ├── locators.js             # Element location strategies
│   ├── selectors.js            # querySelector, findByText
│   ├── visibility.js           # isVisible, isEnabled
│   └── content.js              # textContent, getAttribute
│
├── interactions/               # User interactions
│   ├── click.js                # clickButton, clickElement
│   ├── fill.js                 # fillTextArea
│   └── scroll.js               # scrollIntoView
│
├── utilities/                  # Utility functions
│   ├── wait.js                 # wait(), evaluate()
│   └── url.js                  # getUrl
│
└── high-level/                 # High-level automation patterns
    └── universal-logic.js      # Reusable patterns
```

## Component Relationships

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         makeBrowserCommander()                           │
│                              (index.js)                                  │
│                                                                          │
│  Binds all modules together and provides unified API                     │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────┐      ┌───────────────┐      ┌───────────────────┐
│NetworkTracker │      │NavigationMgr  │      │PageTriggerManager │
│               │      │               │      │                   │
│ • Track HTTP  │◄─────│ • URL changes │◄─────│ • Register        │
│ • Wait idle   │      │ • Abort sigs  │      │   triggers        │
│ • 30s timeout │      │ • Events      │      │ • Start/stop      │
│               │      │               │      │   lifecycle       │
└───────────────┘      └───────────────┘      └───────────────────┘
        ▲                       ▲                       ▲
        │                       │                       │
        │              ┌────────┴────────┐              │
        │              │                 │              │
        │              ▼                 ▼              │
        │     ┌──────────────┐  ┌──────────────┐       │
        │     │ browser/     │  │ interactions/│       │
        │     │ navigation.js│  │ click.js     │       │
        │     │ launcher.js  │  │ fill.js      │       │
        │     └──────────────┘  └──────────────┘       │
        │                                              │
        └──────────────────────────────────────────────┘
                    All use NetworkTracker for idle detection
```

## Key Design Patterns

### 1. Options Object Pattern

All functions accept options as an object for maximum flexibility:

```javascript
await commander.clickButton({
  selector: 'button.submit',
  scrollIntoView: true,
  waitForNavigation: true,
  timeout: 30000,
});
```

### 2. Page Trigger Pattern

Declarative page handlers that automatically manage lifecycle:

```javascript
commander.pageTrigger({
  name: 'checkout-handler',
  condition: makeUrlCondition('*/checkout*'),
  action: async (ctx) => {
    // ctx.checkStopped() - check if should stop
    // ctx.commander - wrapped commander (throws on navigation)
    // ctx.onCleanup(fn) - register cleanup
    await ctx.commander.fillTextArea({ selector: 'input', text: 'value' });
  },
});
```

### 3. Safe Iteration Pattern

`ctx.forEach()` automatically checks for navigation between items:

```javascript
await ctx.forEach(items, async (item) => {
  await ctx.commander.click({ selector: item.selector });
});
```

### 4. Engine Abstraction

Unified API works with both Playwright and Puppeteer:

```javascript
const { browser, page } = await launchBrowser({ engine: 'playwright' });
// or
const { browser, page } = await launchBrowser({ engine: 'puppeteer' });
```

## State Machine Details

### LOADING STATE

When navigation is detected:
1. Signal current action to stop (AbortController.abort())
2. Wait for action cleanup (max 10 seconds)
3. Run cleanup callbacks (ctx.onCleanup)
4. Wait for URL stabilization (no redirects for 1s)
5. Wait for network idle (30s no HTTP requests)

### WORKING STATE

When page is ready:
1. Find matching trigger (condition check)
2. Create action context with wrapped commander
3. Execute action
4. Handle completion or errors

## Network Idle Detection

The library waits for **30 seconds** of zero pending HTTP requests:

```javascript
// Ensures:
// - All lazy-loaded content fetched
// - All analytics complete
// - All async JavaScript executed
// - SPAs fully hydrated
```

## Error Handling

### ActionStoppedError

Thrown when navigation interrupts an action:

```javascript
try {
  await ctx.commander.clickButton({ selector: 'button' });
} catch (error) {
  if (commander.isActionStoppedError(error)) {
    // Navigation happened - action was stopped
    return;
  }
  throw error;
}
```

### Navigation Errors

Handled gracefully with automatic recovery:

```javascript
if (isNavigationError(error)) {
  // Page navigated during operation - normal behavior
}
```

## URL Condition Helpers

Multiple ways to define URL conditions:

```javascript
// Exact match
makeUrlCondition('https://example.com/page')

// Wildcards
makeUrlCondition('*checkout*')

// Route patterns
makeUrlCondition('/vacancy/:id')

// Regex
makeUrlCondition(/\/product\/\d+/)

// Custom function
makeUrlCondition((url, ctx) => url.includes('/admin'))

// Combine
allConditions(condition1, condition2)
anyCondition(condition1, condition2)
notCondition(condition)
```

## Design Principles Applied

### Modularity
- Each module has single responsibility
- Clear boundaries between components
- Easy to test in isolation

### Abstraction
- Unified API hides engine differences
- High-level patterns for common tasks

### Stable Contracts
- Options object pattern prevents breaking changes
- Adding new options is backward compatible

### Separation of Concerns
- Navigation tracking separate from page operations
- Network tracking separate from element interactions
- Trigger management separate from action execution

### Composition Over Complexity
- Complex operations built from simple primitives
- `clickButton` uses `scrollIntoView`, `click`, verification

## Future Improvements

See GitHub issues:
- [#94](https://github.com/konard/hh-job-application-automation/issues/94) - Engine adapter interface
- [#95](https://github.com/konard/hh-job-application-automation/issues/95) - Split large functions
- [#96](https://github.com/konard/hh-job-application-automation/issues/96) - withNavigationSafety wrapper
