# Browser Commander

A Rust library for universal browser automation that provides a unified API for different browser automation engines. The key focus is on **stoppable page triggers** - ensuring automation logic is properly mounted/unmounted during page navigation.

## Installation

Add this to your `Cargo.toml`:

```toml
[dependencies]
browser-commander = "0.4"
tokio = { version = "1.0", features = ["full"] }
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

```rust
use browser_commander::prelude::*;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Launch a browser with chromiumoxide engine
    let options = LaunchOptions::chromiumoxide()
        .headless(true);

    let result = launch_browser(options).await?;
    println!("Browser launched: {:?}", result.browser.engine);

    // Navigate to a URL
    let page = &result.page;
    goto(page, "https://example.com", None).await?;

    // Click a button
    click_button(page, "button.submit", None).await?;

    // Fill a text field
    fill_text_area(page, "input[name='email']", "test@example.com", None).await?;

    Ok(())
}
```

## Features

- **Unified API** across multiple browser engines
- **Built-in navigation safety handling**
- **Element visibility and scroll management**
- **Click, fill, and other interaction support with verification**
- **Async/await support with Tokio**

## API Reference

### Browser Launch

```rust
use browser_commander::prelude::*;

// Launch with chromiumoxide (CDP-based)
let options = LaunchOptions::chromiumoxide()
    .headless(true)
    .user_data_dir("~/.browser-data");

let result = launch_browser(options).await?;
```

### Navigation

```rust
// Navigate to URL
goto(&page, "https://example.com", None).await?;

// Navigate with options
let nav_options = NavigationOptions {
    wait_until: WaitUntil::NetworkIdle,
    timeout: Some(30000),
};
goto(&page, "https://example.com", Some(nav_options)).await?;

// Wait for URL to match condition
wait_for_url_condition(&page, |url| url.contains("success")).await?;
```

### Element Interactions

```rust
// Click a button
click_button(&page, "button.submit", None).await?;

// Click with options
let click_options = ClickOptions {
    scroll_into_view: true,
    wait_for_navigation: true,
    ..Default::default()
};
click_button(&page, "button.submit", Some(click_options)).await?;

// Fill text area
fill_text_area(&page, "textarea.message", "Hello world", None).await?;

// Scroll element into view
scroll_into_view(&page, ".target-element", None).await?;
```

### Element Queries

```rust
// Check visibility
let visible = is_visible(&page, ".element").await?;

// Check if enabled
let enabled = is_enabled(&page, "button.submit").await?;

// Get text content
let text = text_content(&page, ".message").await?;

// Get attribute value
let href = get_attribute(&page, "a.link", "href").await?;

// Count matching elements
let count = count(&page, ".item").await?;
```

### Utilities

```rust
// Wait for a duration
wait(1000).await;

// Get current URL
let url = get_url(&page).await?;

// Parse URL
let parsed = parse_url("https://example.com/path?query=value")?;

// Evaluate JavaScript
let result: String = evaluate(&page, "document.title").await?;
```

## Modules

- `core` - Core types and traits (constants, engine adapter, logger)
- `elements` - Element operations (selectors, visibility, content)
- `interactions` - User interactions (click, scroll, fill)
- `browser` - Browser management (launcher, navigation)
- `utilities` - General utilities (URL handling, wait operations)
- `high_level` - High-level DRY utilities

## Prelude

For convenience, import everything commonly needed with:

```rust
use browser_commander::prelude::*;
```

## Extensibility / Escape Hatch

`browser-commander` cannot anticipate every browser API. When you need an API that is not yet supported, you can access the raw underlying engine objects directly as an **official extensibility escape hatch**.

### Using `LaunchResult` raw fields

`launch_browser()` returns a `LaunchResult` with a `browser` field that contains the engine type and configuration. When using the underlying engine crate (e.g. `chromiumoxide`) directly, the raw browser and page objects are accessible from the engine crate:

```rust
use browser_commander::prelude::*;

let options = LaunchOptions::chromiumoxide().headless(true);
let result = launch_browser(options).await?;

// Access engine metadata
println!("Engine: {:?}", result.browser.engine);
println!("User data dir: {:?}", result.browser.user_data_dir);

// For engine-specific APIs not yet in browser-commander,
// use the underlying engine crate directly alongside browser-commander.
// For example, with chromiumoxide:
//   let (browser, mut handler) = Browser::launch(BrowserConfig::builder()...).await?;
//   let page = browser.new_page("about:blank").await?;
//   // Use page.pdf(), page.emulate_media(), page.keyboard() etc.
```

### Why This Matters

- Users can adopt browser-commander incrementally while retaining access to full engine APIs
- No need for fragile `_page` private-field hacks
- Missing APIs can be [reported as issues](https://github.com/link-foundation/browser-commander/issues) while users remain unblocked

## License

[UNLICENSE](../LICENSE)
