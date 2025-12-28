---
'browser-commander': minor
---

Add support for custom Chrome args in launchBrowser

Adds a new `args` option to the `launchBrowser` function that allows passing custom Chrome arguments to append to the default `CHROME_ARGS`. This is useful for headless server environments (Docker, CI/CD) that require additional flags like `--no-sandbox`, `--disable-setuid-sandbox`, or `--disable-dev-shm-usage`.

Usage example:

```javascript
import { launchBrowser } from 'browser-commander';

const { browser, page } = await launchBrowser({
  engine: 'puppeteer',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
```

Fixes #11
