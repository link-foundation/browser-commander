import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createTraceStop } from '../../../src/traces/stop.js';

it('failed video export still releases the trace resources', async () => {
  const released = [];
  const stop = createTraceStop({
    getStopped: () => false,
    setStopped: () => {},
    options: {},
    detachers: [],
    navigationCapture: async () => {},
    video: {
      stop: async () => {
        throw new Error('encoder failed');
      },
    },
    detachNetwork: async () => released.push('network'),
    mutations: { stop: async () => released.push('mutations') },
    bundle: { abort: async () => released.push('bundle') },
  });
  await assert.rejects(stop(), /encoder failed/);
  assert.deepEqual(released, ['network', 'mutations', 'bundle']);
});
