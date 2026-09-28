import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  WEBDRIVER_KEYS,
  buildEvaluateScript,
  fromWebDriverCookie,
  toCentimetres,
  toConsoleMessage,
  toNetworkRequest,
  toPrintOptions,
  toWebDriverChord,
  toWebDriverCookie,
  toWebDriverKey,
} from '../../../src/core/webdriver-conversions.js';

const closeTo = (actual, expected) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-3,
    `${actual} is not close to ${expected}`
  );

describe('WebDriver key conversion', () => {
  it('passes single characters through and maps key names', () => {
    assert.equal(toWebDriverKey('a'), 'a');
    assert.equal(toWebDriverKey('Enter'), WEBDRIVER_KEYS.Enter);
    assert.equal(WEBDRIVER_KEYS.Enter, String.fromCharCode(0xe007));
    assert.equal(WEBDRIVER_KEYS.Control, String.fromCharCode(0xe009));
  });

  it('rejects unknown key names and empty keys', () => {
    assert.throws(() => toWebDriverKey('NoSuchKey'), /Unknown key "NoSuchKey"/);
    assert.throws(() => toWebDriverKey(''), TypeError);
  });

  it('splits chords, keeping a trailing plus as the plus key', () => {
    assert.deepEqual(toWebDriverChord('Control+A'), [
      WEBDRIVER_KEYS.Control,
      'A',
    ]);
    assert.deepEqual(toWebDriverChord('Control++'), [
      WEBDRIVER_KEYS.Control,
      '+',
    ]);
    assert.deepEqual(toWebDriverChord('+'), ['+']);
  });
});

describe('WebDriver print options', () => {
  it('converts lengths to centimetres', () => {
    closeTo(toCentimetres(96), 2.54);
    closeTo(toCentimetres('1in'), 2.54);
    closeTo(toCentimetres('10mm'), 1);
    closeTo(toCentimetres('2cm'), 2);
    closeTo(toCentimetres('48px'), 1.27);
    assert.throws(() => toCentimetres('1em'), /Cannot convert/);
  });

  it('maps Puppeteer pdf options onto Print Page parameters', () => {
    const print = toPrintOptions({
      format: 'A4',
      landscape: true,
      printBackground: true,
      scale: 0.5,
      pageRanges: '1-2, 4',
      margin: { top: '1cm', left: 96 },
    });
    assert.equal(print.orientation, 'landscape');
    assert.equal(print.background, true);
    assert.equal(print.scale, 0.5);
    assert.deepEqual(print.pageRanges, ['1-2', '4']);
    closeTo(print.width, 21);
    closeTo(print.height, 29.7);
    closeTo(print.top, 1);
    closeTo(print.left, 2.54);
    assert.equal(print.right, undefined);
  });

  it('lets explicit width and height override the format', () => {
    const print = toPrintOptions({ format: 'letter', width: '10cm' });
    closeTo(print.width, 10);
    closeTo(print.height, 27.94);
  });

  it('refuses options WebDriver cannot honour, naming the limitation', () => {
    assert.throws(
      () => toPrintOptions({ displayHeaderFooter: true, headerTemplate: 'x' }),
      /does not support displayHeaderFooter, headerTemplate.*webdriver-print-options/
    );
    assert.throws(
      () => toPrintOptions({ format: 'B5' }),
      /Unknown paper format/
    );
  });

  it('returns no parameters for no options', () => {
    assert.deepEqual(toPrintOptions(), {});
  });
});

describe('WebDriver cookie conversion', () => {
  it('reports session cookies with expires -1', () => {
    const cookie = fromWebDriverCookie({
      name: 'a',
      value: 'bc',
      domain: 'example.com',
      httpOnly: true,
    });
    assert.deepEqual(cookie, {
      name: 'a',
      value: 'bc',
      domain: 'example.com',
      path: '/',
      expires: -1,
      size: 3,
      httpOnly: true,
      secure: false,
      session: true,
    });
  });

  it('keeps expiry and sameSite of persistent cookies', () => {
    const cookie = fromWebDriverCookie({
      name: 'a',
      value: 'b',
      path: '/x',
      expiry: 1900000000,
      sameSite: 'Lax',
    });
    assert.equal(cookie.expires, 1900000000);
    assert.equal(cookie.session, false);
    assert.equal(cookie.sameSite, 'Lax');
  });

  it('turns expires into expiry and drops fields WebDriver does not take', () => {
    assert.deepEqual(
      toWebDriverCookie({
        name: 'a',
        value: 'b',
        url: 'https://example.com',
        expires: 1900000000.7,
        secure: true,
      }),
      { name: 'a', value: 'b', secure: true, expiry: 1900000000 }
    );
    assert.deepEqual(
      toWebDriverCookie({ name: 'a', value: 'b', expires: -1 }),
      {
        name: 'a',
        value: 'b',
      }
    );
  });
});

describe('WebDriver evaluate script', () => {
  it('embeds the function source and reports location.href', async () => {
    const source = buildEvaluateScript((a, b) => a + b);
    assert.match(source, /\(\(a, b\) => a \+ b\)\.apply\(null, args\)/);
    assert.match(source, /location\.href/);
    // The script body runs as a function whose arguments are the call args.
    const location = { href: 'https://example.com/' };
    const run = new Function('location', `return (function () { ${source} })`)(
      location
    );
    assert.deepEqual(await run(2, 3), [5, 'https://example.com/']);
  });

  it('evaluates expression strings', async () => {
    const source = buildEvaluateScript('1 + 1');
    const run = new Function('location', `return (function () { ${source} })`)({
      href: 'about:blank',
    });
    assert.deepEqual(await run(), [2, 'about:blank']);
  });
});

describe('WebDriver BiDi event conversion', () => {
  it('turns log entries into console messages', () => {
    const message = toConsoleMessage({
      level: 'warn',
      method: 'warn',
      text: 'careful',
      args: [{ type: 'string', value: 'careful' }],
      source: { context: 'c', url: 'https://example.com/' },
    });
    assert.equal(message.type(), 'warning');
    assert.equal(message.text(), 'careful');
    assert.equal(message.args().length, 1);
    assert.equal(message.location().url, 'https://example.com/');
  });

  it('turns network events into requests with lower-case headers', () => {
    const request = toNetworkRequest({
      navigation: 'nav-1',
      request: {
        request: 'r1',
        url: 'https://example.com/',
        method: 'GET',
        headers: [{ name: 'Accept', value: { type: 'string', value: '*/*' } }],
      },
      response: { status: 204 },
    });
    assert.equal(request.id, 'r1');
    assert.equal(request.url(), 'https://example.com/');
    assert.equal(request.method(), 'GET');
    assert.deepEqual(request.headers(), { accept: '*/*' });
    assert.equal(request.isNavigationRequest(), true);
    assert.equal(request.response().status(), 204);
    assert.equal(request.failure(), undefined);
    assert.deepEqual(
      toNetworkRequest({ request: {}, errorText: 'net::ERR_FAILED' }).failure(),
      { errorText: 'net::ERR_FAILED' }
    );
  });
});
