---
'browser-commander': minor
---

Add isTimeoutError function for detecting timeout errors

Adds a new `isTimeoutError` function exported from the library that helps detect timeout errors from selector waiting operations. This function is complementary to `isNavigationError` and allows automation loops to handle timeout errors gracefully without crashing.

Usage example:

```javascript
import { isTimeoutError } from 'browser-commander';

try {
  await page.waitForSelector('.button');
} catch (error) {
  if (isTimeoutError(error)) {
    console.log('Timeout occurred, continuing with next item...');
  }
}
```
