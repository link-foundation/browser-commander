/**
 * A running Chromium-family browser addressed only by its DevTools endpoint:
 * identify it, and ask it to shut down. Used by persistent sessions, their
 * watchdog, and hand-off reconnection (issue #174), none of which hold an
 * engine connection when they need to.
 */

/** `/json/version` of a CDP HTTP endpoint, or null when nothing answers. */
export function probeSession(endpoint) {
  return fetch(`${endpoint}/json/version`, {
    signal: AbortSignal.timeout(1000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

/** Send `Browser.close` over a browser WebSocket and wait for the socket to close. */
export async function closeRemoteBrowser(endpoint) {
  await new Promise((resolve, reject) => {
    const socket = new globalThis.WebSocket(endpoint);
    let acknowledged = false;
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('Browser.close timed out'));
    }, 3000);
    socket.onopen = () =>
      socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    socket.onclose = () => {
      clearTimeout(timer);
      resolve();
    };
    socket.onerror = () => {
      // Chrome can close the TCP connection without a WebSocket close frame
      // after acknowledging Browser.close. Its ensuing close event completes
      // shutdown; a pre-acknowledgement connection error remains a failure.
      if (!acknowledged) {
        clearTimeout(timer);
        reject(new Error('Browser.close connection failed'));
      }
    };
    socket.onmessage = ({ data }) => {
      const response = JSON.parse(data);
      if (response.id !== 1) {
        return;
      }
      if (response.error) {
        clearTimeout(timer);
        reject(new Error(response.error.message ?? 'Browser.close failed'));
        socket.close();
      } else {
        acknowledged = true;
      }
    };
  });
}
