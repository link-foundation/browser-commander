---
'browser-commander': minor
---

Add the `fingerprint` subsystem, which removes the differences between a browser this library controls and one started by hand. `navigator.webdriver` stays false because the `AutomationControlled` Blink feature is disabled at launch, and `launchBrowser()` no longer passes the engine defaults a real Chrome does not carry. `resolveFingerprintProfile()` validates the 19 environment fields a page can read -- user agent and client hints, languages and locale, time zone, platform, cores, memory, screen, viewport, touch, WebGL strings, geolocation and the media preferences -- `createFingerprintPreset()` builds internally consistent Windows, macOS, Linux and Android machines, and `applyFingerprint()` installs a profile over CDP for both Playwright and Puppeteer. `FINGERPRINT_LIMITATIONS` documents what still cannot be made identical, and `relevantFingerprintLimitations()` narrows it to the entries a given profile and browser actually hit.
