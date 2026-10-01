/* global chrome, WebSocket */
import { createRelayClient } from './relay-handler.js';

/**
 * Service worker of the Browser Commander Relay extension (issue #102,
 * addendum, mode 2). All logic lives in relay-handler.js; this file only
 * wires it to the real `chrome` namespace. `start()` runs synchronously at top
 * level because MV3 only delivers events to listeners registered then.
 */
createRelayClient({
  chrome,
  WebSocket,
  userAgent: navigator.userAgent,
}).start();
