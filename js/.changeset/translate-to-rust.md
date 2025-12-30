---
'browser-commander': minor
---

Add Rust implementation with parallel JavaScript codebase reorganization

This introduces a complete Rust translation of the browser-commander library alongside the existing JavaScript implementation. The codebase is now organized into two parallel structures:

- `js/` - JavaScript implementation (all existing functionality preserved)
- `rust/` - New Rust implementation with the same modular architecture

Key features of the Rust implementation:

- Unified API across multiple browser engines (chromiumoxide, fantoccini)
- Core types and traits (constants, engine adapter, logger)
- Element operations (selectors, visibility, content)
- User interactions (click, scroll, fill)
- Browser management (launcher, navigation)
- General utilities (URL handling, wait operations)
- High-level DRY utilities
- Comprehensive test coverage with 106 tests
