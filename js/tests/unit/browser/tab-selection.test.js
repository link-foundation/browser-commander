import { it } from 'node:test';
import assert from 'node:assert/strict';
import { pickForegroundPage } from '../../../src/browser/connector.js';

it('explicit URL selection wins over emulated visibility', async () => {
  const pages = ['background', 'automation'].map((name) => ({
    url: () => `https://example.com/${name}`,
    evaluate: async () => 'visible',
  }));
  assert.equal(
    await pickForegroundPage(pages, { url: /automation/ }),
    pages[1]
  );
  await assert.rejects(pickForegroundPage(pages, { url: /missing/ }), /No tab/);
});

it('focus emulation is disabled before reading foreground visibility', async () => {
  let emulated = true;
  const session = {
    send: async (method) => {
      if (method === 'Emulation.setFocusEmulationEnabled') {
        emulated = false;
      }
      return { targetInfo: { targetId: 'background' } };
    },
    detach: async () => {},
  };
  const context = { newCDPSession: async () => session };
  const background = {
    context: () => context,
    evaluate: async () => (emulated ? 'visible' : 'hidden'),
  };
  const foreground = {
    context: () => context,
    evaluate: async () => 'visible',
  };
  assert.equal(await pickForegroundPage([background, foreground]), foreground);
});
