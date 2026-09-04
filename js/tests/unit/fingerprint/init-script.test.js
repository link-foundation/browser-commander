import { describe, it } from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';

import {
  buildFingerprintInitScript,
  buildInitScriptConfig,
} from '../../../src/fingerprint/init-script.js';
import { resolveFingerprintProfile } from '../../../src/fingerprint/profile.js';

/**
 * Run a generated init script in a throwaway realm that looks enough like a
 * page to exercise every patch: the payload only ever touches prototypes it
 * finds on the global object, so a handful of stand-in constructors is all it
 * needs. Running it for real is what proves the descriptor shapes, the
 * `[native code]` masking and the double-application guard, none of which a
 * string comparison would catch.
 */
function runInFakeRealm(script, { hostValues = {} } = {}) {
  const context = vm.createContext({});
  vm.runInContext(
    `
    function Navigator() {}
    function WorkerNavigator() {}
    function Screen() {}
    function WebGLRenderingContext() {}
    function WebGL2RenderingContext() {}
    const host = ${JSON.stringify({
      deviceMemory: 64,
      vendor: 'Host Vendor',
      platform: 'HostPlatform',
      language: 'xx-XX',
      languages: ['xx-XX'],
      doNotTrack: '1',
      hardwareConcurrency: 128,
      maxTouchPoints: 0,
      ...hostValues,
    })};
    for (const property of Object.keys(host)) {
      const value = host[property];
      Object.defineProperty(Navigator.prototype, property, {
        get() { return value; },
        enumerable: true,
        configurable: true,
      });
      Object.defineProperty(WorkerNavigator.prototype, property, {
        get() { return value; },
        enumerable: true,
        configurable: true,
      });
    }
    for (const property of ['width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth']) {
      Object.defineProperty(Screen.prototype, property, {
        get() { return 1; },
        enumerable: true,
        configurable: true,
      });
    }
    for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
      this[name].prototype.getParameter = function getParameter(parameter) {
        return 'real-' + parameter;
      };
    }
    globalThis.navigator = new Navigator();
    globalThis.screen = new Screen();
    globalThis.gl = new WebGLRenderingContext();
    `,
    context
  );
  vm.runInContext(script, context);
  return context;
}

describe('init script config', () => {
  it('rejects anything that is not a profile object', () => {
    assert.throws(
      () => buildFingerprintInitScript(undefined),
      /must be a normalized fingerprint profile/u
    );
  });

  it('returns null when the browser-side overrides already cover everything', () => {
    const profile = resolveFingerprintProfile({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0',
      timezoneId: 'UTC',
      hardwareConcurrency: 8,
      maxTouchPoints: 0,
    });

    assert.equal(buildInitScriptConfig(profile), null);
    assert.equal(buildFingerprintInitScript(profile), null);
  });

  it('patches only the fields the Emulation domain has no command for', () => {
    const profile = resolveFingerprintProfile({
      deviceMemory: 8,
      vendor: 'Google Inc.',
      doNotTrack: '1',
      hardwareConcurrency: 8,
      timezoneId: 'UTC',
    });

    // hardwareConcurrency and timezoneId are browser-enforced, so they must
    // not appear in the weaker JavaScript patch.
    assert.deepEqual(Object.keys(buildInitScriptConfig(profile)).sort(), [
      'deviceMemory',
      'doNotTrack',
      'vendor',
    ]);
  });

  it('adds webdriver only when the caller asks for it', () => {
    const profile = resolveFingerprintProfile({ vendor: 'Google Inc.' });

    assert.equal(buildInitScriptConfig(profile).webdriver, undefined);
    assert.equal(
      buildInitScriptConfig(profile, { patchWebdriver: true }).webdriver,
      false
    );
  });

  it('patches webdriver even for an otherwise empty profile', () => {
    const script = buildFingerprintInitScript(resolveFingerprintProfile({}), {
      patchWebdriver: true,
    });

    assert.ok(script);
    const context = runInFakeRealm(script);
    assert.equal(vm.runInContext('navigator.webdriver', context), false);
  });

  it('leaves languages to the browser unless explicitly asked', () => {
    const profile = resolveFingerprintProfile({ languages: ['fr-FR', 'fr'] });

    assert.equal(buildInitScriptConfig(profile), null);
    assert.deepEqual(
      buildInitScriptConfig(profile, { patchLanguages: true }).languages,
      ['fr-FR', 'fr']
    );
  });

  it('drops the screen dimensions setDeviceMetricsOverride already enforces', () => {
    const config = buildInitScriptConfig(
      resolveFingerprintProfile({
        screen: {
          width: 1920,
          height: 1080,
          availWidth: 1920,
          availHeight: 1032,
          colorDepth: 24,
          pixelDepth: 24,
        },
      })
    );

    assert.deepEqual(Object.keys(config.screen).sort(), [
      'availHeight',
      'availWidth',
      'colorDepth',
      'pixelDepth',
    ]);
  });

  it('skips the screen patch when only width and height are given', () => {
    assert.equal(
      buildInitScriptConfig(
        resolveFingerprintProfile({ screen: { width: 1920, height: 1080 } })
      ),
      null
    );
  });
});

describe('init script behaviour in a page-like realm', () => {
  const profile = resolveFingerprintProfile({
    deviceMemory: 8,
    vendor: 'Google Inc.',
    doNotTrack: null,
    platform: 'Win32',
    languages: ['de-DE', 'de'],
    screen: {
      width: 1920,
      height: 1080,
      availWidth: 1920,
      availHeight: 1032,
      colorDepth: 24,
      pixelDepth: 24,
    },
    webgl: {
      vendor: 'WebKit',
      renderer: 'WebKit WebGL',
      unmaskedVendor: 'Google Inc. (NVIDIA)',
      unmaskedRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, D3D11)',
    },
  });
  const script = buildFingerprintInitScript(profile, {
    patchWebdriver: true,
    patchLanguages: true,
  });

  it('replaces the values a page reads from navigator', () => {
    const context = runInFakeRealm(script);

    assert.equal(vm.runInContext('navigator.deviceMemory', context), 8);
    assert.equal(vm.runInContext('navigator.vendor', context), 'Google Inc.');
    assert.equal(vm.runInContext('navigator.webdriver', context), false);
    assert.equal(vm.runInContext('navigator.language', context), 'de-DE');
    assert.deepEqual(
      vm.runInContext('Array.from(navigator.languages)', context),
      ['de-DE', 'de']
    );
  });

  it('hands out a frozen copy of languages so page code cannot mutate ours', () => {
    const context = runInFakeRealm(script);

    assert.equal(
      vm.runInContext('Object.isFrozen(navigator.languages)', context),
      true
    );
    assert.equal(
      vm.runInContext('navigator.languages !== navigator.languages', context),
      true
    );
  });

  it('patches only the screen fields the profile named', () => {
    const context = runInFakeRealm(script);

    assert.equal(vm.runInContext('screen.availHeight', context), 1032);
    assert.equal(vm.runInContext('screen.colorDepth', context), 24);
    // width and height stay with the browser-side override.
    assert.equal(vm.runInContext('screen.width', context), 1);
  });

  it('answers the WebGL renderer queries and forwards everything else', () => {
    const context = runInFakeRealm(script);

    // 0x9245/0x9246 are UNMASKED_VENDOR_WEBGL/UNMASKED_RENDERER_WEBGL.
    assert.equal(
      vm.runInContext('gl.getParameter(0x9245)', context),
      'Google Inc. (NVIDIA)'
    );
    assert.equal(vm.runInContext('gl.getParameter(0x1f00)', context), 'WebKit');
    assert.equal(
      vm.runInContext('gl.getParameter(0x1234)', context),
      'real-4660'
    );
  });

  it('keeps the descriptor shape of a real accessor', () => {
    const context = runInFakeRealm(script);
    const descriptor = vm.runInContext(
      `(() => {
        const d = Object.getOwnPropertyDescriptor(Navigator.prototype, 'deviceMemory');
        return {
          enumerable: d.enumerable,
          configurable: d.configurable,
          hasGetter: typeof d.get === 'function',
          setter: d.set,
          name: d.get.name,
        };
      })()`,
      context
    );

    assert.deepEqual(descriptor, {
      enumerable: true,
      configurable: true,
      hasGetter: true,
      setter: undefined,
      name: 'get deviceMemory',
    });
  });

  it('makes the replacements report native source', () => {
    const context = runInFakeRealm(script);

    assert.equal(
      vm.runInContext(
        "Object.getOwnPropertyDescriptor(Navigator.prototype, 'deviceMemory').get.toString()",
        context
      ),
      'function get deviceMemory() { [native code] }'
    );
    assert.equal(
      vm.runInContext(
        'WebGLRenderingContext.prototype.getParameter.toString()',
        context
      ),
      'function getParameter() { [native code] }'
    );
    // The masking of toString itself has to be masked too, or the patch is
    // detectable by asking the one function that does the lying.
    assert.equal(
      vm.runInContext('Function.prototype.toString.toString()', context),
      'function toString() { [native code] }'
    );
    // Untouched functions still report their real source.
    assert.match(
      vm.runInContext('(function example() { return 1; }).toString()', context),
      /return 1/u
    );
  });

  it('does not stack getters when the script runs twice', () => {
    const context = runInFakeRealm(script);
    vm.runInContext(script, context);

    assert.equal(vm.runInContext('navigator.deviceMemory', context), 8);
    assert.equal(
      vm.runInContext(
        'WebGLRenderingContext.prototype.getParameter.toString()',
        context
      ),
      'function getParameter() { [native code] }'
    );
    assert.equal(
      vm.runInContext('gl.getParameter(0x1234)', context),
      'real-4660'
    );
  });

  it('hides its own marker from enumeration', () => {
    const context = runInFakeRealm(script);

    assert.equal(
      vm.runInContext(
        "Object.keys(globalThis).includes('__browserCommanderFingerprint')",
        context
      ),
      false
    );
  });
});
