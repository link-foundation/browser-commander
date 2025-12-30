# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- changelog-insert-here -->

## [0.1.0] - 2024-12-30

### Added

- Initial Rust implementation of browser-commander library
- Core modules: constants, logger, engine adapter trait, navigation safety
- Elements modules: selectors, visibility checking, content extraction
- Interactions modules: click, scroll, fill operations with verification
- Browser modules: launcher, navigation operations
- Utilities modules: URL handling, wait/sleep operations
- High-level universal DRY utilities
- 103 unit tests and 3 doc tests
- Async/await support with Tokio runtime
- Chrome DevTools Protocol support via chromiumoxide
- WebDriver support via fantoccini
