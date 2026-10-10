import { it } from 'node:test';
import assert from 'node:assert/strict';
import { dismissOverlays } from '../../../src/interactions/overlays.js';

it('dismisses the first visible match and reports errors without failing the interaction', async () => {
  const clicks = [],
    reports = [];
  const targets = [
    { isVisible: async () => false, click: async () => clicks.push('hidden') },
    {
      isVisible: async () => true,
      click: async () => {
        clicks.push('visible');
        throw new Error('detached');
      },
    },
  ];
  const locator = {
    first: () => targets[0],
    count: async () => targets.length,
    nth: (i) => targets[i],
  };
  await dismissOverlays({
    page: { locator: () => locator },
    engine: 'playwright',
    overlays: ['.dismiss'],
    onDismiss: (report) => reports.push(report),
  });
  assert.deepEqual(clicks, ['visible']);
  assert.equal(reports[0].status, 'error');
  assert.equal(reports[0].error.message, 'detached');
});

it('reports successful dismissal and isolates reporting callback errors', async () => {
  let clicked = false;
  const target = {
    isVisible: async () => true,
    click: async () => {
      clicked = true;
    },
  };
  const reports = [];
  await dismissOverlays({
    page: { locator: () => ({ count: async () => 1, nth: () => target }) },
    engine: 'playwright',
    overlays: [
      {
        selector: '.dismiss',
        onDismiss: (result) => {
          reports.push(result);
          throw new Error('reporting');
        },
      },
    ],
  });
  assert.equal(clicked, true);
  assert.equal(reports[0].status, 'dismissed');
});
