import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  EngineAdapter,
  PlaywrightAdapter,
  PuppeteerAdapter,
  createEngineAdapter,
} from '../../../src/core/engine-adapter.js';
import { createMockPlaywrightPage, createMockPuppeteerPage } from '../../helpers/mocks.js';

describe('engine-adapter', () => {
  describe('EngineAdapter (base class)', () => {
    it('should throw on abstract methods', () => {
      const adapter = new EngineAdapter({});

      assert.throws(() => adapter.getEngineName(), /must be implemented/);
      assert.throws(() => adapter.createLocator('sel'), /must be implemented/);
    });
  });

  describe('PlaywrightAdapter', () => {
    let page;
    let adapter;

    it('should create adapter', () => {
      page = createMockPlaywrightPage();
      adapter = new PlaywrightAdapter(page);
      assert.ok(adapter);
    });

    it('should return playwright as engine name', () => {
      page = createMockPlaywrightPage();
      adapter = new PlaywrightAdapter(page);
      assert.strictEqual(adapter.getEngineName(), 'playwright');
    });

    it('should create locator from selector', () => {
      page = createMockPlaywrightPage();
      adapter = new PlaywrightAdapter(page);
      const locator = adapter.createLocator('button');
      assert.ok(locator);
    });

    it('should handle :nth-of-type selector', () => {
      page = createMockPlaywrightPage();
      adapter = new PlaywrightAdapter(page);
      const locator = adapter.createLocator('button:nth-of-type(2)');
      assert.ok(locator);
    });

    it('should query single element', async () => {
      page = createMockPlaywrightPage({ elements: { 'button': { count: 1 } } });
      adapter = new PlaywrightAdapter(page);
      const element = await adapter.querySelector('button');
      assert.ok(element);
    });

    it('should return null when element not found', async () => {
      page = createMockPlaywrightPage({ elements: { 'button': { count: 0 } } });
      adapter = new PlaywrightAdapter(page);
      const element = await adapter.querySelector('button');
      assert.strictEqual(element, null);
    });

    it('should query all elements', async () => {
      page = createMockPlaywrightPage({ elements: { 'button': { count: 3 } } });
      adapter = new PlaywrightAdapter(page);
      const elements = await adapter.querySelectorAll('button');
      assert.strictEqual(elements.length, 3);
    });

    it('should count elements', async () => {
      page = createMockPlaywrightPage({ elements: { 'button': { count: 5 } } });
      adapter = new PlaywrightAdapter(page);
      const count = await adapter.count('button');
      assert.strictEqual(count, 5);
    });
  });

  describe('PuppeteerAdapter', () => {
    let page;
    let adapter;

    it('should create adapter', () => {
      page = createMockPuppeteerPage();
      adapter = new PuppeteerAdapter(page);
      assert.ok(adapter);
    });

    it('should return puppeteer as engine name', () => {
      page = createMockPuppeteerPage();
      adapter = new PuppeteerAdapter(page);
      assert.strictEqual(adapter.getEngineName(), 'puppeteer');
    });

    it('should return selector string as locator', () => {
      page = createMockPuppeteerPage();
      adapter = new PuppeteerAdapter(page);
      const locator = adapter.createLocator('button');
      assert.strictEqual(locator, 'button');
    });

    it('should query single element', async () => {
      page = createMockPuppeteerPage({ elements: { 'button': { count: 1 } } });
      adapter = new PuppeteerAdapter(page);
      const element = await adapter.querySelector('button');
      assert.ok(element);
    });

    it('should return null when element not found', async () => {
      page = createMockPuppeteerPage({ elements: { 'button': { count: 0 } } });
      adapter = new PuppeteerAdapter(page);
      const element = await adapter.querySelector('button');
      assert.strictEqual(element, null);
    });

    it('should query all elements', async () => {
      page = createMockPuppeteerPage({ elements: { 'button': { count: 3 } } });
      adapter = new PuppeteerAdapter(page);
      const elements = await adapter.querySelectorAll('button');
      assert.strictEqual(elements.length, 3);
    });

    it('should count elements', async () => {
      page = createMockPuppeteerPage({ elements: { 'button': { count: 5 } } });
      adapter = new PuppeteerAdapter(page);
      const count = await adapter.count('button');
      assert.strictEqual(count, 5);
    });
  });

  describe('createEngineAdapter', () => {
    it('should create PlaywrightAdapter for playwright engine', () => {
      const page = createMockPlaywrightPage();
      const adapter = createEngineAdapter(page, 'playwright');
      assert.ok(adapter instanceof PlaywrightAdapter);
    });

    it('should create PuppeteerAdapter for puppeteer engine', () => {
      const page = createMockPuppeteerPage();
      const adapter = createEngineAdapter(page, 'puppeteer');
      assert.ok(adapter instanceof PuppeteerAdapter);
    });

    it('should throw for unknown engine', () => {
      const page = createMockPlaywrightPage();
      assert.throws(
        () => createEngineAdapter(page, 'unknown'),
        /Unsupported engine/
      );
    });

    it('should throw when page is not provided', () => {
      assert.throws(
        () => createEngineAdapter(null, 'playwright'),
        /page is required/
      );
    });

    it('should throw when page is undefined', () => {
      assert.throws(
        () => createEngineAdapter(undefined, 'playwright'),
        /page is required/
      );
    });
  });
});
