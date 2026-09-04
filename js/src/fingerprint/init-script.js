/**
 * Page init script for the fingerprint surfaces CDP cannot override.
 *
 * Everything here is strictly worse than a browser-enforced override: a
 * JavaScript patch is visible to anyone who inspects the property descriptor
 * carefully enough, and it does not reach workers or HTTP headers. It exists
 * only for fields the `Emulation` domain has no command for -- see
 * `limitations.js` for the measured list -- and for `connectBrowser`, where the
 * launch switches were already fixed by whoever started the browser.
 *
 * The payload is written as a real function and serialized with `String()`
 * rather than kept in a template literal, so it stays lintable and formattable
 * like the rest of the source.
 */

/**
 * Runs inside the page, before any page script, in every frame.
 *
 * @param {object} config Plain JSON produced by `buildInitScriptConfig`.
 */
function fingerprintPayload(config) {
  const scope = globalThis;
  // Playwright and Puppeteer both re-inject init scripts on same-document
  // navigations in some versions; patching twice would stack getters and make
  // the descriptor chain observable.
  const marker = '__browserCommanderFingerprint';
  if (scope[marker]) {
    return;
  }
  Object.defineProperty(scope, marker, {
    value: true,
    configurable: true,
    enumerable: false,
    writable: false,
  });

  const nativeSources = new WeakMap();
  const functionToString = Function.prototype.toString;
  const objectDefineProperty = Object.defineProperty;

  /** Make a replacement report `[native code]`, like the accessor it replaces. */
  function asNative(fn, name) {
    try {
      objectDefineProperty(fn, 'name', {
        value: name,
        configurable: true,
        enumerable: false,
        writable: false,
      });
    } catch {
      // A frozen function name is not worth failing the whole patch over.
    }
    nativeSources.set(fn, `function ${name}() { [native code] }`);
    return fn;
  }

  const patchedToString = function toString() {
    const source = nativeSources.get(this);
    return source === undefined ? functionToString.call(this) : source;
  };
  nativeSources.set(patchedToString, functionToString.call(functionToString));
  Function.prototype.toString = patchedToString;

  /**
   * Replace a native accessor on a prototype, keeping the shape a real one has:
   * an enumerable, configurable getter with no setter, named `get <property>`.
   */
  function defineNativeGetter(target, property, produce) {
    if (!target) {
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(target, property);
    if (descriptor && !descriptor.configurable) {
      return;
    }
    const getter = asNative(() => produce(), `get ${property}`);
    try {
      objectDefineProperty(target, property, {
        get: getter,
        set: undefined,
        enumerable: descriptor ? descriptor.enumerable : true,
        configurable: true,
      });
    } catch {
      // Some engines refuse redefinition on cross-origin-ish prototypes.
    }
  }

  const navigatorPrototype = scope.Navigator && scope.Navigator.prototype;
  const workerNavigatorPrototype =
    scope.WorkerNavigator && scope.WorkerNavigator.prototype;

  function defineNavigator(property, value) {
    defineNativeGetter(navigatorPrototype, property, () => value);
    defineNativeGetter(workerNavigatorPrototype, property, () => value);
  }

  if (config.webdriver !== undefined) {
    defineNavigator('webdriver', config.webdriver);
  }
  if (config.deviceMemory !== undefined) {
    defineNavigator('deviceMemory', config.deviceMemory);
  }
  if (config.hardwareConcurrency !== undefined) {
    defineNavigator('hardwareConcurrency', config.hardwareConcurrency);
  }
  if (config.vendor !== undefined) {
    defineNavigator('vendor', config.vendor);
  }
  if (config.platform !== undefined) {
    defineNavigator('platform', config.platform);
  }
  if (config.maxTouchPoints !== undefined) {
    defineNavigator('maxTouchPoints', config.maxTouchPoints);
  }
  if (config.doNotTrack !== undefined) {
    defineNativeGetter(
      navigatorPrototype,
      'doNotTrack',
      () => config.doNotTrack
    );
  }
  if (config.languages !== undefined) {
    // navigator.languages is a frozen array in Chrome; hand out a fresh frozen
    // copy so page code cannot mutate the one we hold.
    defineNavigator('language', config.languages[0]);
    defineNativeGetter(navigatorPrototype, 'languages', () =>
      Object.freeze(config.languages.slice())
    );
    defineNativeGetter(workerNavigatorPrototype, 'languages', () =>
      Object.freeze(config.languages.slice())
    );
  }

  const screenPrototype = scope.Screen && scope.Screen.prototype;
  if (config.screen) {
    for (const property of Object.keys(config.screen)) {
      const value = config.screen[property];
      defineNativeGetter(screenPrototype, property, () => value);
    }
  }

  if (config.webgl) {
    // 0x9245/0x9246 are UNMASKED_VENDOR_WEBGL and UNMASKED_RENDERER_WEBGL from
    // the WEBGL_debug_renderer_info extension; 0x1F00/0x1F01 are the plain
    // VENDOR and RENDERER constants that need no extension at all.
    const replacements = new Map();
    if (config.webgl.unmaskedVendor !== undefined) {
      replacements.set(0x9245, config.webgl.unmaskedVendor);
    }
    if (config.webgl.unmaskedRenderer !== undefined) {
      replacements.set(0x9246, config.webgl.unmaskedRenderer);
    }
    if (config.webgl.vendor !== undefined) {
      replacements.set(0x1f00, config.webgl.vendor);
    }
    if (config.webgl.renderer !== undefined) {
      replacements.set(0x1f01, config.webgl.renderer);
    }
    for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
      const prototype = scope[name] && scope[name].prototype;
      if (!prototype || typeof prototype.getParameter !== 'function') {
        continue;
      }
      const original = prototype.getParameter;
      const patched = asNative(function getParameter(parameter) {
        if (replacements.has(parameter)) {
          return replacements.get(parameter);
        }
        return original.call(this, parameter);
      }, 'getParameter');
      prototype.getParameter = patched;
    }
  }
}

const SCREEN_FIELDS = [
  'width',
  'height',
  'availWidth',
  'availHeight',
  'colorDepth',
  'pixelDepth',
];

/**
 * Decide what the init script still has to do once the browser-side overrides
 * have been applied.
 *
 * @param {object} profile Normalized fingerprint profile.
 * @param {object} [options]
 * @param {boolean} [options.patchWebdriver] Force `navigator.webdriver` to
 *   `false` from JavaScript. Only needed when the browser was launched by
 *   somebody else and the automation switches can no longer be changed.
 * @param {boolean} [options.patchLanguages] Also patch `navigator.languages`.
 * @returns {object|null} Config for the payload, or `null` when nothing is left.
 */
export function buildInitScriptConfig(profile, options = {}) {
  const config = {};

  if (options.patchWebdriver) {
    config.webdriver = false;
  }
  if (profile.deviceMemory !== undefined) {
    config.deviceMemory = profile.deviceMemory;
  }
  if (profile.vendor !== undefined) {
    config.vendor = profile.vendor;
  }
  if (profile.doNotTrack !== undefined) {
    config.doNotTrack = profile.doNotTrack;
  }
  if (options.patchLanguages && profile.languages !== undefined) {
    config.languages = [...profile.languages];
  }
  if (profile.webgl !== undefined) {
    config.webgl = { ...profile.webgl };
  }
  if (profile.screen !== undefined) {
    const screen = {};
    for (const field of SCREEN_FIELDS) {
      if (profile.screen[field] !== undefined) {
        screen[field] = profile.screen[field];
      }
    }
    // width and height are already enforced by setDeviceMetricsOverride; the
    // avail*/depth fields are not, so only those need patching.
    delete screen.width;
    delete screen.height;
    if (Object.keys(screen).length > 0) {
      config.screen = screen;
    }
  }

  return Object.keys(config).length > 0 ? config : null;
}

/**
 * Serialize the init script for a profile.
 *
 * @param {object} profile Normalized fingerprint profile.
 * @param {object} [options] See `buildInitScriptConfig`.
 * @returns {string|null} Script source, or `null` when no patching is needed.
 */
export function buildFingerprintInitScript(profile, options = {}) {
  if (!profile || typeof profile !== 'object') {
    throw new TypeError('profile must be a normalized fingerprint profile');
  }
  const config = buildInitScriptConfig(profile, options);
  if (!config) {
    return null;
  }
  return `(${String(fingerprintPayload)})(${JSON.stringify(config)});`;
}
