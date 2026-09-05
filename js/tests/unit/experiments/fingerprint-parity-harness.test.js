/**
 * The projection the parity runners compare on.
 *
 * Three runners used to read the probe report through long
 * `report?.a?.b ?? null` chains - flat tables of twenty-odd fields that ESLint
 * counted as functions with a cyclomatic complexity of 40, 50 and 53. The
 * chains are now paths through readReportPath(), so these tests pin the two
 * properties the runners depended on: a missing level yields the fallback
 * rather than throwing, and a value that is present is returned unchanged even
 * when it is falsy.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  projectReport,
  readReportPath,
} from '../../../../experiments/fingerprint-parity/harness.mjs';

describe('readReportPath', () => {
  it('reads a nested value', () => {
    assert.equal(
      readReportPath({ webgl: { webgl1: { unmaskedVendor: 'Intel' } } }, [
        'webgl',
        'webgl1',
        'unmaskedVendor',
      ]),
      'Intel'
    );
  });

  it('returns the fallback for a level the report never sent', () => {
    // A browser that failed half the probe still POSTs what it collected, so
    // every level of the path can be absent.
    assert.equal(
      readReportPath({}, ['webgl', 'webgl1', 'unmaskedVendor']),
      undefined
    );
    assert.equal(
      readReportPath(undefined, ['navigator', 'webdriver'], null),
      null
    );
    assert.equal(
      readReportPath({ intl: null }, ['intl', 'dateTimeLocale'], null),
      null
    );
  });

  it('keeps a falsy value that the report actually reported', () => {
    // `navigator.webdriver: false` is the single most important reading in the
    // whole suite; a fallback applied to it would report a pass as a miss.
    assert.equal(
      readReportPath(
        { navigator: { webdriver: false } },
        ['navigator', 'webdriver'],
        null
      ),
      false
    );
    assert.equal(
      readReportPath({ plugins: [] }, ['plugins', 'length'], null),
      0
    );
  });

  it('reads a key that is not an identifier', () => {
    assert.equal(
      readReportPath({ mediaQueries: { '(pointer: coarse)': true } }, [
        'mediaQueries',
        '(pointer: coarse)',
      ]),
      true
    );
  });
});

describe('projectReport', () => {
  it('names every field it was asked for, present or not', () => {
    const projected = projectReport(
      { navigator: { webdriver: false } },
      {
        webdriver: ['navigator', 'webdriver'],
        userAgent: ['navigator', 'userAgent'],
      },
      null
    );

    assert.deepEqual(projected, { webdriver: false, userAgent: null });
  });

  it('leaves an absent field undefined when no fallback is given', () => {
    assert.deepEqual(projectReport({}, { screen: ['screen'] }), {
      screen: undefined,
    });
  });
});
