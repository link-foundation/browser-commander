import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  HandleTable,
  compileFunction,
  decodeValue,
  describeObject,
  encodeValue,
  isPlainObject,
  typeName,
} from '../../../src/cli/handles.js';

class Page {
  goto() {}
  get mainFrame() {
    throw new Error('getters must not run while describing');
  }
  _private() {}
}
class Page2 extends Page {}

describe('value encoding round-trip (no browser)', () => {
  const cases = [
    ['null', null],
    ['booleans', [true, false]],
    ['strings and numbers', { text: 'a', count: 3.5 }],
    ['undefined', undefined],
    ['nested plain objects', { a: { b: [1, { c: 'd' }] } }],
  ];
  for (const [name, value] of cases) {
    it(`keeps ${name}`, () => {
      const handles = new HandleTable();
      assert.deepEqual(
        decodeValue(
          JSON.parse(JSON.stringify(encodeValue(value, handles))),
          handles
        ),
        value
      );
    });
  }

  it('tags binary, dates, regexps, bigints and errors', () => {
    const handles = new HandleTable();
    const value = {
      bytes: Buffer.from('hi'),
      when: new Date('2026-01-02T03:04:05.000Z'),
      pattern: /a+b/giu,
      big: 12345678901234567890n,
      failure: new TypeError('boom'),
      missing: undefined,
    };
    const wire = JSON.parse(JSON.stringify(encodeValue(value, handles)));

    assert.deepEqual(wire, {
      bytes: { $binary: 'aGk=' },
      when: { $date: '2026-01-02T03:04:05.000Z' },
      pattern: { $regexp: { source: 'a+b', flags: 'giu' } },
      big: { $bigint: '12345678901234567890' },
      failure: { $error: { name: 'TypeError', message: 'boom' } },
      missing: { $undefined: true },
    });

    const decoded = decodeValue(wire, handles);
    assert.ok(Buffer.isBuffer(decoded.bytes));
    assert.equal(decoded.bytes.toString(), 'hi');
    assert.equal(decoded.when.getTime(), value.when.getTime());
    assert.equal(decoded.pattern.toString(), '/a+b/giu');
    assert.equal(decoded.big, value.big);
    assert.equal(decoded.failure.name, 'TypeError');
    assert.equal(decoded.failure.message, 'boom');
    assert.ok('missing' in decoded && decoded.missing === undefined);
  });

  it('turns class instances and functions into handles and back', () => {
    const handles = new HandleTable();
    const page = new Page();
    const callback = () => 1;

    const wire = encodeValue({ page, callback, again: page }, handles);

    assert.deepEqual(wire, {
      page: { $handle: 'h1', type: 'Page' },
      callback: { $handle: 'h2', type: 'Function' },
      again: { $handle: 'h1', type: 'Page' },
    });
    const decoded = decodeValue(wire, handles);
    assert.equal(decoded.page, page);
    assert.equal(decoded.callback, callback);
  });

  it('compiles $function sources and keeps their source text', () => {
    const handles = new HandleTable();
    const fn = decodeValue({ $function: '(a, b) => a + b' }, handles);

    assert.equal(fn(2, 3), 5);
    assert.equal(fn.toString(), '(a, b) => a + b');
    assert.throws(() => compileFunction('1 +'), /Invalid \$function/u);
    assert.throws(() => compileFunction('42'), /did not evaluate/u);
  });

  it('encodes cycles as handles instead of recursing forever', () => {
    const handles = new HandleTable();
    const node = { name: 'root' };
    node.self = node;

    const wire = encodeValue(node, handles);

    assert.equal(wire.name, 'root');
    assert.deepEqual(wire.self, { $handle: 'h1', type: 'Object' });
  });

  it('maps non-finite numbers to null and symbols to strings', () => {
    const handles = new HandleTable();
    assert.deepEqual(encodeValue([Number.NaN, Infinity], handles), [
      null,
      null,
    ]);
    assert.equal(encodeValue(Symbol('s'), handles), 'Symbol(s)');
  });
});

describe('HandleTable', () => {
  it('allocates deterministic ids and disposes them', () => {
    const handles = new HandleTable();
    const first = {};
    Object.setPrototypeOf(first, Page.prototype);

    assert.equal(handles.register(first).$handle, 'h1');
    assert.equal(handles.register(new Page()).$handle, 'h2');
    assert.equal(handles.dispose('h1'), true);
    assert.equal(handles.dispose('h1'), false);
    assert.throws(() => handles.get('h1'), { code: -32602 });
    assert.equal(handles.register(first).$handle, 'h3');
  });
});

describe('describeObject', () => {
  it('lists public methods across the prototype chain without calling getters', () => {
    const description = describeObject(new Page2());

    assert.equal(description.type, 'Page');
    assert.ok(description.methods.includes('goto'));
    assert.ok(description.methods.includes('hasOwnProperty') === false);
    assert.ok(!description.methods.includes('_private'));
    assert.ok(description.properties.includes('mainFrame'));
  });

  it('describes primitives as empty', () => {
    assert.deepEqual(describeObject(null), {
      type: 'Object',
      methods: [],
      properties: [],
    });
  });
});

describe('type names', () => {
  it('drops bundler suffixes and recognizes plain objects', () => {
    assert.equal(typeName(new Page2()), 'Page');
    assert.equal(
      typeName(() => {}),
      'Function'
    );
    assert.equal(isPlainObject({}), true);
    assert.equal(isPlainObject(Object.create(null)), true);
    assert.equal(isPlainObject(new Page()), false);
  });
});
