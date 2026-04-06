import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  pressKey,
  typeText,
  keyDown,
  keyUp,
} from '../../../src/interactions/keyboard.js';
import {
  PlaywrightAdapter,
  PuppeteerAdapter,
} from '../../../src/core/engine-adapter.js';
import {
  createMockPlaywrightPage,
  createMockPuppeteerPage,
} from '../../helpers/mocks.js';

describe('keyboard interactions', () => {
  // ---------------------------------------------------------------------------
  // pressKey
  // ---------------------------------------------------------------------------
  describe('pressKey', () => {
    it('should press a key using Playwright adapter', async () => {
      const pressedKeys = [];
      const page = createMockPlaywrightPage();
      page.keyboard.press = async (key) => {
        pressedKeys.push(key);
      };

      await pressKey({ page, engine: 'playwright', key: 'Escape' });

      assert.deepStrictEqual(pressedKeys, ['Escape']);
    });

    it('should press a key using Puppeteer adapter', async () => {
      const pressedKeys = [];
      const page = createMockPuppeteerPage();
      page.keyboard.press = async (key) => {
        pressedKeys.push(key);
      };

      await pressKey({ page, engine: 'puppeteer', key: 'Enter' });

      assert.deepStrictEqual(pressedKeys, ['Enter']);
    });

    it('should accept a pre-created adapter', async () => {
      const pressedKeys = [];
      const adapter = {
        keyboardPress: async (key) => {
          pressedKeys.push(key);
        },
      };

      await pressKey({ key: 'Tab', adapter });

      assert.deepStrictEqual(pressedKeys, ['Tab']);
    });

    it('should throw when key is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => pressKey({ page, engine: 'playwright' }),
        /key is required/
      );
    });
  });

  // ---------------------------------------------------------------------------
  // typeText
  // ---------------------------------------------------------------------------
  describe('typeText', () => {
    it('should type text using Playwright adapter', async () => {
      const typedTexts = [];
      const page = createMockPlaywrightPage();
      page.keyboard.type = async (text) => {
        typedTexts.push(text);
      };

      await typeText({ page, engine: 'playwright', text: 'Hello World' });

      assert.deepStrictEqual(typedTexts, ['Hello World']);
    });

    it('should type text using Puppeteer adapter', async () => {
      const typedTexts = [];
      const page = createMockPuppeteerPage();
      page.keyboard.type = async (text) => {
        typedTexts.push(text);
      };

      await typeText({ page, engine: 'puppeteer', text: 'Hello World' });

      assert.deepStrictEqual(typedTexts, ['Hello World']);
    });

    it('should accept a pre-created adapter', async () => {
      const typedTexts = [];
      const adapter = {
        keyboardType: async (text) => {
          typedTexts.push(text);
        },
      };

      await typeText({ text: 'test input', adapter });

      assert.deepStrictEqual(typedTexts, ['test input']);
    });

    it('should throw when text is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => typeText({ page, engine: 'playwright' }),
        /text is required/
      );
    });
  });

  // ---------------------------------------------------------------------------
  // keyDown
  // ---------------------------------------------------------------------------
  describe('keyDown', () => {
    it('should hold a key down using Playwright adapter', async () => {
      const downKeys = [];
      const page = createMockPlaywrightPage();
      page.keyboard.down = async (key) => {
        downKeys.push(key);
      };

      await keyDown({ page, engine: 'playwright', key: 'Control' });

      assert.deepStrictEqual(downKeys, ['Control']);
    });

    it('should hold a key down using Puppeteer adapter', async () => {
      const downKeys = [];
      const page = createMockPuppeteerPage();
      page.keyboard.down = async (key) => {
        downKeys.push(key);
      };

      await keyDown({ page, engine: 'puppeteer', key: 'Shift' });

      assert.deepStrictEqual(downKeys, ['Shift']);
    });

    it('should accept a pre-created adapter', async () => {
      const downKeys = [];
      const adapter = {
        keyboardDown: async (key) => {
          downKeys.push(key);
        },
      };

      await keyDown({ key: 'Alt', adapter });

      assert.deepStrictEqual(downKeys, ['Alt']);
    });

    it('should throw when key is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => keyDown({ page, engine: 'playwright' }),
        /key is required/
      );
    });
  });

  // ---------------------------------------------------------------------------
  // keyUp
  // ---------------------------------------------------------------------------
  describe('keyUp', () => {
    it('should release a key using Playwright adapter', async () => {
      const upKeys = [];
      const page = createMockPlaywrightPage();
      page.keyboard.up = async (key) => {
        upKeys.push(key);
      };

      await keyUp({ page, engine: 'playwright', key: 'Control' });

      assert.deepStrictEqual(upKeys, ['Control']);
    });

    it('should release a key using Puppeteer adapter', async () => {
      const upKeys = [];
      const page = createMockPuppeteerPage();
      page.keyboard.up = async (key) => {
        upKeys.push(key);
      };

      await keyUp({ page, engine: 'puppeteer', key: 'Shift' });

      assert.deepStrictEqual(upKeys, ['Shift']);
    });

    it('should accept a pre-created adapter', async () => {
      const upKeys = [];
      const adapter = {
        keyboardUp: async (key) => {
          upKeys.push(key);
        },
      };

      await keyUp({ key: 'Meta', adapter });

      assert.deepStrictEqual(upKeys, ['Meta']);
    });

    it('should throw when key is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => keyUp({ page, engine: 'playwright' }),
        /key is required/
      );
    });
  });

  // ---------------------------------------------------------------------------
  // PlaywrightAdapter keyboard methods
  // ---------------------------------------------------------------------------
  describe('PlaywrightAdapter keyboard methods', () => {
    it('should delegate keyboardPress to page.keyboard.press', async () => {
      const pressedKeys = [];
      const page = createMockPlaywrightPage();
      page.keyboard.press = async (key) => pressedKeys.push(key);

      const adapter = new PlaywrightAdapter(page);
      await adapter.keyboardPress('Escape');

      assert.deepStrictEqual(pressedKeys, ['Escape']);
    });

    it('should delegate keyboardType to page.keyboard.type', async () => {
      const typedTexts = [];
      const page = createMockPlaywrightPage();
      page.keyboard.type = async (text) => typedTexts.push(text);

      const adapter = new PlaywrightAdapter(page);
      await adapter.keyboardType('hello');

      assert.deepStrictEqual(typedTexts, ['hello']);
    });

    it('should delegate keyboardDown to page.keyboard.down', async () => {
      const downKeys = [];
      const page = createMockPlaywrightPage();
      page.keyboard.down = async (key) => downKeys.push(key);

      const adapter = new PlaywrightAdapter(page);
      await adapter.keyboardDown('Control');

      assert.deepStrictEqual(downKeys, ['Control']);
    });

    it('should delegate keyboardUp to page.keyboard.up', async () => {
      const upKeys = [];
      const page = createMockPlaywrightPage();
      page.keyboard.up = async (key) => upKeys.push(key);

      const adapter = new PlaywrightAdapter(page);
      await adapter.keyboardUp('Control');

      assert.deepStrictEqual(upKeys, ['Control']);
    });
  });

  // ---------------------------------------------------------------------------
  // PuppeteerAdapter keyboard methods
  // ---------------------------------------------------------------------------
  describe('PuppeteerAdapter keyboard methods', () => {
    it('should delegate keyboardPress to page.keyboard.press', async () => {
      const pressedKeys = [];
      const page = createMockPuppeteerPage();
      page.keyboard.press = async (key) => pressedKeys.push(key);

      const adapter = new PuppeteerAdapter(page);
      await adapter.keyboardPress('Enter');

      assert.deepStrictEqual(pressedKeys, ['Enter']);
    });

    it('should delegate keyboardType to page.keyboard.type', async () => {
      const typedTexts = [];
      const page = createMockPuppeteerPage();
      page.keyboard.type = async (text) => typedTexts.push(text);

      const adapter = new PuppeteerAdapter(page);
      await adapter.keyboardType('world');

      assert.deepStrictEqual(typedTexts, ['world']);
    });

    it('should delegate keyboardDown to page.keyboard.down', async () => {
      const downKeys = [];
      const page = createMockPuppeteerPage();
      page.keyboard.down = async (key) => downKeys.push(key);

      const adapter = new PuppeteerAdapter(page);
      await adapter.keyboardDown('Shift');

      assert.deepStrictEqual(downKeys, ['Shift']);
    });

    it('should delegate keyboardUp to page.keyboard.up', async () => {
      const upKeys = [];
      const page = createMockPuppeteerPage();
      page.keyboard.up = async (key) => upKeys.push(key);

      const adapter = new PuppeteerAdapter(page);
      await adapter.keyboardUp('Shift');

      assert.deepStrictEqual(upKeys, ['Shift']);
    });
  });
});
