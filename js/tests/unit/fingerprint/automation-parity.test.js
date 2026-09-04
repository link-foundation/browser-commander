import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  applyAutomationParityArgs,
  AUTOMATION_CONTROLLED_OFF_ARG,
  AUTOMATION_CONTROLLED_TRIGGERS,
  detectAutomationControlledTriggers,
  disablesAutomationControlled,
  ENGINE_PARITY_IGNORED_DEFAULT_ARGS,
  parityIgnoredDefaultArgs,
  PLAYWRIGHT_HEADLESS_POINTER_ARG,
  PLAYWRIGHT_SOFTWARE_WEBGL_ARG,
} from '../../../src/fingerprint/automation-parity.js';

describe('AutomationControlled triggers', () => {
  it('documents a reason for every trigger', () => {
    assert.ok(AUTOMATION_CONTROLLED_TRIGGERS.length > 0);
    for (const trigger of AUTOMATION_CONTROLLED_TRIGGERS) {
      assert.equal(typeof trigger.switch, 'string');
      assert.ok(trigger.reason.length > 0, `${trigger.switch} needs a reason`);
    }
  });

  it('finds each switch Chromium maps onto the feature', () => {
    const found = detectAutomationControlledTriggers([
      '--enable-automation',
      '--headless=new',
      '--remote-debugging-pipe',
      '--remote-debugging-port=0',
    ]).map((entry) => entry.switch);

    assert.deepEqual(found, [
      '--enable-automation',
      '--headless',
      '--remote-debugging-pipe',
      '--remote-debugging-port=0',
    ]);
  });

  it('reports the argument as written next to the switch it matched', () => {
    assert.deepEqual(
      detectAutomationControlledTriggers(['--headless=new'])[0].argument,
      '--headless=new'
    );
  });

  it('leaves a fixed debugging port alone', () => {
    // runtime_features.cc treats only an ephemeral port as automation, because
    // a specific port is what a human attaching a debugger passes.
    assert.deepEqual(
      detectAutomationControlledTriggers(['--remote-debugging-port=9222']),
      []
    );
  });

  it('finds nothing in an ordinary command line', () => {
    assert.deepEqual(
      detectAutomationControlledTriggers([
        '--no-first-run',
        '--window-size=1280,720',
      ]),
      []
    );
  });

  it('rejects a non-array or a non-string argument', () => {
    assert.throws(
      () => detectAutomationControlledTriggers('--headless'),
      /must be an array of strings/u
    );
    assert.throws(
      () => detectAutomationControlledTriggers([1]),
      /must be an array of strings/u
    );
  });
});

describe('applying automation parity to a command line', () => {
  it('appends the switch that turns the feature back off', () => {
    assert.deepEqual(applyAutomationParityArgs(['--no-first-run']), [
      '--no-first-run',
      AUTOMATION_CONTROLLED_OFF_ARG,
    ]);
  });

  it('works on an empty command line and on no command line at all', () => {
    assert.deepEqual(applyAutomationParityArgs([]), [
      AUTOMATION_CONTROLLED_OFF_ARG,
    ]);
    assert.deepEqual(applyAutomationParityArgs(), [
      AUTOMATION_CONTROLLED_OFF_ARG,
    ]);
  });

  it('is idempotent', () => {
    const once = applyAutomationParityArgs(['--no-first-run']);
    assert.deepEqual(applyAutomationParityArgs(once), once);
  });

  it('extends an existing feature list instead of duplicating the switch', () => {
    // Chrome keeps only the last --disable-blink-features occurrence, so a
    // second one would silently drop the caller's features.
    assert.deepEqual(
      applyAutomationParityArgs(['--disable-blink-features=AcceptCHFrame']),
      ['--disable-blink-features=AcceptCHFrame,AutomationControlled']
    );
  });

  it('does not copy the input array back to the caller', () => {
    const args = ['--no-first-run'];
    assert.notEqual(applyAutomationParityArgs(args), args);
    assert.deepEqual(args, ['--no-first-run']);
  });

  it('rejects a non-array', () => {
    assert.throws(
      () => applyAutomationParityArgs('--no-first-run'),
      /must be an array of strings/u
    );
  });

  it('recognises the feature inside a longer list', () => {
    assert.equal(
      disablesAutomationControlled([
        '--disable-blink-features=AcceptCHFrame, AutomationControlled',
      ]),
      true
    );
    assert.equal(
      disablesAutomationControlled(['--disable-blink-features=AcceptCHFrame']),
      false
    );
    assert.equal(disablesAutomationControlled([]), false);
    // Enabling is not disabling.
    assert.equal(
      disablesAutomationControlled([
        '--enable-blink-features=AutomationControlled',
      ]),
      false
    );
  });
});

describe('engine default switches to suppress', () => {
  it('suppresses --enable-automation on both engines', () => {
    for (const engine of ['playwright', 'puppeteer']) {
      assert.ok(
        parityIgnoredDefaultArgs(engine).includes('--enable-automation'),
        `${engine} must suppress --enable-automation`
      );
    }
  });

  it('suppresses the Playwright headless pointer switch only when headless', () => {
    // Playwright forces hover:hover and pointer:fine in headless Chrome, which
    // a real headless browser never reports; see parity-headless.json.
    assert.ok(
      !parityIgnoredDefaultArgs('playwright').includes(
        PLAYWRIGHT_HEADLESS_POINTER_ARG
      )
    );
    assert.ok(
      parityIgnoredDefaultArgs('playwright', { headless: true }).includes(
        PLAYWRIGHT_HEADLESS_POINTER_ARG
      )
    );
  });

  it('suppresses the Playwright software-WebGL switch in both modes', () => {
    // Playwright 1.62 pushes --enable-unsafe-swiftshader on every platform, so
    // a machine with no usable GPU answers getContext('webgl') with a
    // SwiftShader context where a hand-started Chrome answers null. Measured in
    // analysis-artifacts/parity-webgl-swiftshader.json; the switch has to go in
    // both modes, because headless Chrome turns SwiftShader on by itself.
    for (const headless of [false, true]) {
      assert.ok(
        parityIgnoredDefaultArgs('playwright', { headless }).includes(
          PLAYWRIGHT_SOFTWARE_WEBGL_ARG
        ),
        `playwright must suppress ${PLAYWRIGHT_SOFTWARE_WEBGL_ARG} when headless=${headless}`
      );
    }
  });

  it('has nothing extra to suppress for headless Puppeteer', () => {
    assert.deepEqual(
      parityIgnoredDefaultArgs('puppeteer', { headless: true }),
      ['--enable-automation']
    );
  });

  it('rejects an unknown engine by name', () => {
    assert.throws(
      () => parityIgnoredDefaultArgs('selenium'),
      /unknown engine "selenium"/u
    );
  });

  it('does not let a caller mutate the shared table', () => {
    assert.ok(Object.isFrozen(ENGINE_PARITY_IGNORED_DEFAULT_ARGS));
    assert.ok(
      Object.isFrozen(ENGINE_PARITY_IGNORED_DEFAULT_ARGS.playwright.always)
    );
    const result = parityIgnoredDefaultArgs('playwright');
    result.push('--mutated');
    assert.deepEqual(parityIgnoredDefaultArgs('playwright'), [
      '--enable-automation',
      PLAYWRIGHT_SOFTWARE_WEBGL_ARG,
    ]);
  });
});
