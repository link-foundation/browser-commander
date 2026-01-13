---
'browser-commander': patch
---

Fix normalizeSelector to validate input type and reject arrays

When `normalizeSelector` receives an invalid type (array, number, or non-text-selector object), it now returns `null` with a warning instead of returning the invalid value unchanged.

This prevents downstream `querySelectorAll` errors with invalid selector syntax (like trailing commas when arrays are accidentally passed).

Fixes #23
