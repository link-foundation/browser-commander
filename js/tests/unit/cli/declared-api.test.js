import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  parseDeclaredMethods,
  playwrightDeclarations,
  puppeteerDeclarations,
} from '../../helpers/declared-api.js';

const SOURCE = `
export declare abstract class Page extends EventEmitter<PageEvents> {
  #private;
  protected constructor();
  private _internal(): void;
  static create(): Page;
  get keyboard(): Keyboard;
  readonly url: string;
  abstract goto(url: string): Promise<void>;
  $eval<
    Selector extends string,
  >(selector: Selector): Promise<unknown>;
  waitFor?(): void;
  /**
   * docs(): not a member
   */
}
export interface Locator {
  click(options?: {
    force?: boolean;
    trial(): void;
  }): Promise<void>;
  on(event: 'x', listener: () => void): this;
  on(event: 'y', listener: () => void): this;
}
`;

describe('parseDeclaredMethods', () => {
  it('keeps public methods and drops accessors, statics and privates', () => {
    const types = parseDeclaredMethods(SOURCE);

    assert.deepEqual([...types.get('Page')], ['goto', '$eval', 'waitFor']);
    assert.deepEqual([...types.get('Locator')], ['click', 'on']);
  });

  it('reads the installed Playwright and Puppeteer declarations', () => {
    assert.ok(playwrightDeclarations().get('Page').has('goto'));
    assert.ok(puppeteerDeclarations().get('Page').has('createCDPSession'));
  });
});
