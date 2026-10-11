import fs from 'node:fs/promises';
import path from 'node:path';
import { withDeadline } from './deadline.js';
import {
  normalizePrivacyOptions,
  redactText,
  redactHeaders as privateHeaders,
} from './redaction.js';

const PRIVATE_HEADERS = new Set([
  'cookie',
  'authorization',
  'proxy-authorization',
  'set-cookie',
]);
export function redactHeaders(headers = {}) {
  return privateHeaders(
    Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [
        key.toLowerCase(),
        PRIVATE_HEADERS.has(key.toLowerCase()) ? '[redacted]' : value,
      ])
    ),
    normalizePrivacyOptions()
  );
}

export function isTextBody(contentType = '') {
  return /^(?:text\/|application\/(?:[\w.+-]*json|[\w.+-]*xml|javascript|x-www-form-urlencoded))|multipart\/form-data/i.test(
    contentType
  );
}

function matches(url, pattern) {
  if (pattern === undefined) {
    return true;
  }
  if (typeof pattern === 'function') {
    return Boolean(pattern(url));
  }
  if (pattern instanceof RegExp) {
    pattern.lastIndex = 0;
    return pattern.test(url);
  }
  return url.includes(String(pattern));
}

export function networkHar(events) {
  const requests = new Map(
    events
      .filter((event) => event.kind === 'network.request')
      .map((event) => [event.requestId, event])
  );
  const headers = (value) =>
    Object.entries(value ?? {}).map(([name, value]) => ({
      name,
      value: String(value),
    }));
  const entries = events
    .filter((event) => event.kind === 'network.response')
    .map((response) => {
      const request = requests.get(response.requestId) ?? response;
      const timing = response.timing ?? request.timing ?? {};
      return {
        startedDateTime: request.at ?? new Date().toISOString(),
        time: Math.max(0, timing.responseEnd ?? 0),
        request: {
          method: request.method,
          url: request.url,
          httpVersion: 'HTTP/1.1',
          headers: headers(request.headers),
          cookies: [],
          queryString: [],
          headersSize: -1,
          bodySize: -1,
          ...(request.postData !== undefined
            ? {
                postData: {
                  mimeType: request.headers?.['content-type'] ?? '',
                  text: request.postData,
                  _truncated: request.postDataTruncated,
                },
              }
            : {}),
        },
        response: {
          status: response.status,
          statusText: response.statusText ?? '',
          httpVersion: 'HTTP/1.1',
          headers: headers(response.headers),
          cookies: [],
          redirectURL: response.headers?.location ?? '',
          headersSize: -1,
          bodySize: response.body?.size ?? -1,
          content: {
            size: response.body?.size ?? 0,
            mimeType: response.contentType ?? '',
            ...(response.body?.data !== undefined
              ? {
                  text: response.body.data,
                  ...(response.body.encoding === 'utf8'
                    ? {}
                    : { encoding: 'base64' }),
                  _truncated: response.body.truncated,
                }
              : {}),
          },
        },
        cache: {},
        timings: {
          send: 0,
          wait: Math.max(
            0,
            (timing.responseStart ?? 0) - (timing.requestStart ?? 0)
          ),
          receive: Math.max(
            0,
            (timing.responseEnd ?? 0) - (timing.responseStart ?? 0)
          ),
        },
        _resourceType: response.resourceType,
      };
    });
  return {
    log: {
      version: '1.2',
      creator: { name: 'browser-commander', version: '1' },
      entries,
    },
  };
}

/** Observe without fetching again, and drain responses before closing the bundle. */
export function validateNetworkOptions(network) {
  if (!network) {
    return;
  }
  const options = network === true ? {} : network;
  if (
    typeof options !== 'object' ||
    !Number.isSafeInteger(options.maxBodyBytes ?? 1024 * 1024) ||
    (options.maxBodyBytes ?? 0) < 0 ||
    (options.maxBodyBytes ?? 0) > 16 * 1024 * 1024
  ) {
    throw new RangeError(
      'network.maxBodyBytes must be an integer between 0 and 16 MiB'
    );
  }
}
export function attachNetwork({
  page,
  network,
  record,
  note,
  privacy = normalizePrivacyOptions(),
}) {
  validateNetworkOptions(network);
  if (!network) {
    return async () => {};
  }
  const options = network === true ? {} : network;
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 0) {
    throw new RangeError('network.maxBodyBytes must be a nonnegative integer');
  }
  const ids = new WeakMap();
  const pending = new Set();
  let sequence = 0;
  const details = (request) => ({
    requestId: ids.get(request),
    method: request.method(),
    url: request.url(),
    resourceType: request.resourceType?.() ?? 'other',
    timing: request.timing?.() ?? null,
  });
  const allowed = (request) =>
    (!options.resourceTypes ||
      options.resourceTypes.includes(request.resourceType?.())) &&
    matches(request.url(), options.urlPattern ?? options.url);
  const track = (promise) => {
    pending.add(promise);
    promise.finally(() => pending.delete(promise)).catch(() => {});
  };
  const request = (request) => {
    if (!allowed(request)) {
      return;
    }
    ids.set(request, ++sequence);
    track(
      record('network.request', {
        ...details(request),
        headers: redactHeaders(request.headers?.()),
        ...(options.bodies &&
        ['document', 'xhr', 'fetch'].includes(request.resourceType?.()) &&
        request.postData?.()
          ? {
              postData: Buffer.from(
                redactText(request.postData(), privacy, {
                  kind: 'network',
                  name: 'postData',
                })
              )
                .subarray(0, maxBodyBytes)
                .toString('utf8'),
              postDataTruncated:
                Buffer.byteLength(request.postData()) > maxBodyBytes,
            }
          : {}),
      })
    );
  };
  const response = (response) => {
    const request = response.request();
    if (!ids.has(request)) {
      return;
    }
    const saturated = pending.size >= 32;
    track(
      (async () => {
        const headers = redactHeaders(
          await withDeadline(
            Promise.resolve(response.allHeaders?.() ?? response.headers()),
            5000,
            'network headers'
          )
        );
        const payload = {
          ...details(request),
          status: response.status(),
          statusText: response.statusText?.() ?? '',
          headers,
          contentType: headers['content-type'] ?? null,
        };
        const resourceType = payload.resourceType;
        if (
          !saturated &&
          options.bodies &&
          ['document', 'xhr', 'fetch'].includes(resourceType)
        ) {
          let length = Number(headers['content-length']);
          if (!Number.isFinite(length) && request.sizes) {
            const sizes = await withDeadline(
              request.sizes(),
              5000,
              'network sizes'
            ).catch(() => ({}));
            length = sizes.responseBodySize ?? NaN;
          }
          if (!isTextBody(payload.contentType ?? '')) {
            payload.body = {
              size: Number.isFinite(length) ? length : null,
              omitted: 'binary',
            };
          } else if (Number.isFinite(length) && length > maxBodyBytes) {
            payload.body = {
              size: length,
              truncated: true,
              omitted: 'size limit',
            };
          } else {
            try {
              const data = Buffer.from(
                await withDeadline(
                  response.body?.() ?? response.buffer(),
                  5000,
                  'network body'
                )
              );
              payload.body = {
                size: data.length,
                truncated: data.length > maxBodyBytes,
                encoding: 'utf8',
                data: Buffer.from(
                  redactText(data.toString('utf8'), privacy, {
                    kind: 'network',
                    name: 'responseBody',
                  })
                )
                  .subarray(0, maxBodyBytes)
                  .toString('utf8'),
              };
            } catch (error) {
              payload.bodyError = error.message;
            }
          }
        }
        if (saturated && options.bodies) {
          payload.bodyError = 'body capture concurrency limit';
        }
        await record('network.response', payload);
      })().catch((error) => note(`network capture: ${error.message}`))
    );
  };
  page.on('request', request);
  page.on('response', response);
  return async () => {
    page.off('request', request);
    page.off('response', response);
    await Promise.allSettled([...pending]);
  };
}

export async function writeHar(opened, output) {
  await fs.writeFile(
    output ?? path.join(opened.path, 'network.har'),
    JSON.stringify(networkHar(opened.events), null, 2),
    { mode: 0o600 }
  );
}
