# Browser Commander (Python)

A universal browser automation library for Python that supports both Playwright and Selenium with a unified API. The key focus is on **stoppable page triggers** - ensuring automation logic is properly mounted/unmounted during page navigation.

## Installation

```bash
pip install browser-commander
```

You'll also need either Playwright or Selenium:

```bash
# With Playwright
pip install browser-commander[playwright]
playwright install chromium

# Or with Selenium
pip install browser-commander[selenium]
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

```python
import asyncio
from browser_commander import (
    launch_browser,
    make_browser_commander,
    make_url_condition,
    LaunchOptions,
)


async def main():
    # 1. Launch browser
    options = LaunchOptions(engine="playwright")
    result = await launch_browser(options)
    browser, page = result.browser, result.page

    # 2. Create commander
    commander = make_browser_commander(page=page, verbose=True)

    # 3. Register page trigger with condition and action
    async def example_action(ctx):
        print(f"Processing: {ctx['url']}")
        # Perform automation tasks
        await ctx["commander"].click_button(selector="button.submit")

    commander.page_trigger({
        "name": "example-trigger",
        "condition": make_url_condition("*example.com*"),
        "action": example_action,
    })

    # 4. Navigate - action auto-starts when page is ready
    await commander.goto(url="https://example.com")

    # 5. Cleanup
    await commander.destroy()
    await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
```

## URL Condition Helpers

The `make_url_condition` helper makes it easy to create URL matching conditions:

```python
import re
from browser_commander import (
    make_url_condition,
    all_conditions,
    any_condition,
    not_condition,
)

# Exact URL match
make_url_condition("https://example.com/page")

# Contains substring (use * wildcards)
make_url_condition("*checkout*")  # URL contains 'checkout'
make_url_condition("*example.com*")  # URL contains 'example.com'

# Starts with / ends with
make_url_condition("/api/*")  # starts with '/api/'
make_url_condition("*.json")  # ends with '.json'

# Express-style route patterns
make_url_condition("/vacancy/:id")  # matches /vacancy/123
make_url_condition("https://hh.ru/vacancy/:vacancyId")

# RegExp
make_url_condition(re.compile(r"/product/\d+"))

# Custom function
make_url_condition(lambda url: url.startswith("https://"))

# Combine conditions
all_conditions(
    make_url_condition("*example.com*"),
    make_url_condition("*/checkout*"),
)  # Both must match

any_condition(
    make_url_condition("*/cart*"),
    make_url_condition("*/checkout*"),
)  # Either matches

not_condition(make_url_condition("*/admin*"))  # Negation
```

## API Reference

### launch_browser(options)

```python
from browser_commander import launch_browser, LaunchOptions

options = LaunchOptions(
    engine="playwright",  # 'playwright' or 'selenium'
    headless=False,  # Run in headless mode
    user_data_dir="~/.browser-commander/playwright-data",
    slow_mo=150,  # Slow down operations (ms)
    verbose=False,  # Enable debug logging
    args=["--no-sandbox"],  # Custom Chrome args
)
result = await launch_browser(options)
browser, page = result.browser, result.page
```

### make_browser_commander(page, options)

```python
from browser_commander import make_browser_commander

commander = make_browser_commander(
    page=page,  # Required: Playwright/Selenium page
    verbose=False,  # Enable debug logging
    enable_network_tracking=True,  # Track HTTP requests
    enable_navigation_manager=True,  # Enable navigation events
)
```

### commander.goto(url, options)

```python
result = await commander.goto(
    url="https://example.com",
    wait_until="domcontentloaded",
    timeout=60000,
)
print(f"Navigated: {result['navigated']}, URL: {result['actual_url']}")
```

### commander.click_button(selector, options)

```python
result = await commander.click_button(
    selector="button.submit",
    scroll_into_view=True,
    wait_after_click=1000,
)
print(f"Clicked: {result['clicked']}, Navigated: {result['navigated']}")
```

### commander.fill_text_area(selector, text, options)

```python
result = await commander.fill_text_area(
    selector="textarea.message",
    text="Hello world",
    check_empty=True,
)
print(f"Filled: {result['filled']}, Value: {result['actual_value']}")
```

### Element Selection Methods

```python
# Query single element
element = await commander.query_selector("button.submit")

# Query all matching elements
elements = await commander.query_selector_all(".list-item")

# Wait for selector
found = await commander.wait_for_selector("button.submit", visible=True, timeout=5000)

# Find by text content
selector = commander.find_by_text("Click me", selector="button", exact=False)
```

### Element Inspection Methods

```python
# Check visibility
is_vis = await commander.is_visible("button.submit")

# Check if enabled
is_en = await commander.is_enabled("button.submit")

# Count matching elements
count = await commander.count(".list-item")

# Get text content
text = await commander.text_content(".heading")

# Get input value
value = await commander.input_value("input.email")

# Get attribute
href = await commander.get_attribute("a.link", "href")
```

### Wait and Evaluate Methods

```python
# Wait for time
result = await commander.wait(ms=1000, reason="waiting for animation")
print(f"Completed: {result['completed']}, Aborted: {result['aborted']}")

# Evaluate JavaScript
result = await commander.evaluate("() => document.title")

# Safe evaluate (doesn't throw on navigation)
result = await commander.safe_evaluate(
    fn="() => document.title",
    default_value="Unknown",
)
print(f"Success: {result['success']}, Value: {result['value']}")
```

### commander.destroy()

```python
await commander.destroy()  # Stop actions, cleanup
```

## Best Practices

### 1. Always Cleanup Resources

```python
async def main():
    result = await launch_browser(options)
    browser, page = result.browser, result.page
    commander = make_browser_commander(page=page)

    try:
        # Your automation code
        await commander.goto(url="https://example.com")
    finally:
        await commander.destroy()
        await browser.close()
```

### 2. Use Verbose Mode for Debugging

```python
commander = make_browser_commander(page=page, verbose=True)
```

### 3. Handle Navigation-Aware Operations

```python
# Wait for page to be fully ready after navigation
await commander.wait_for_page_ready(timeout=30000)

# Check if should abort current operation
if commander.should_abort():
    return  # Navigation detected, stop current action
```

## Architecture

The Python implementation follows the same architecture as the JavaScript version:

- **Core Module**: Constants, logger, engine detection, navigation safety
- **Browser Module**: Launcher, navigation management
- **Elements Module**: Selectors, visibility, content extraction
- **Interactions Module**: Click, fill, scroll operations
- **Utilities Module**: Wait, URL helpers
- **High-Level Module**: Universal logic, page triggers

## License

[UNLICENSE](../LICENSE)
