/**
 * Redaction applied before a trace byte reaches disk (issue #87).
 *
 * Browser traces routinely contain credentials. Redaction therefore runs
 * where the data is produced — inside the page for DOM and control state, and
 * on every string this module touches for URLs, headers and messages — rather
 * than as a pass over a file that has already been written.
 */

/** What replaces a redacted value. Recognizable, and never a valid secret. */
export const REDACTED = '[redacted]';

/** Controls whose value is a secret unless the caller says otherwise. */
export const DEFAULT_REDACT_SELECTORS = Object.freeze([
  'input[type=password]',
  '[data-private]',
  '[data-bc-redact]',
]);

/** Attributes and headers that carry credentials. */
export const DEFAULT_REDACT_ATTRIBUTES = Object.freeze([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
]);

/** Query parameters that carry credentials in a URL. */
export const DEFAULT_REDACT_QUERY_PARAMS = Object.freeze([
  'access_token',
  'api_key',
  'apikey',
  'auth',
  'code',
  'id_token',
  'password',
  'refresh_token',
  'secret',
  'session',
  'signature',
  'token',
]);

function lowerSet(values) {
  return [...new Set(values.map((value) => String(value).toLowerCase()))];
}

/**
 * Turn the caller's `privacy` option into the shape every writer uses.
 *
 * @param {Object} [privacy] - Caller privacy options
 * @returns {Object} Normalized privacy options
 */
export function normalizePrivacyOptions(privacy = {}) {
  if (privacy === null || typeof privacy !== 'object') {
    throw new Error('trace privacy options must be an object');
  }

  const {
    redactSelectors = [],
    redactAttributes = [],
    redactQueryParams = [],
    redactPatterns = [],
    redact = null,
    // Defaults are additive: a caller adds to the safe set rather than
    // silently replacing it, so a new selector cannot uncover passwords.
    useDefaults = true,
  } = privacy;

  if (redact !== null && typeof redact !== 'function') {
    throw new Error('privacy.redact must be a function');
  }

  return {
    redactSelectors: lowerSet([
      ...(useDefaults ? DEFAULT_REDACT_SELECTORS : []),
      ...redactSelectors,
    ]),
    redactAttributes: lowerSet([
      ...(useDefaults ? DEFAULT_REDACT_ATTRIBUTES : []),
      ...redactAttributes,
    ]),
    redactQueryParams: lowerSet([
      ...(useDefaults ? DEFAULT_REDACT_QUERY_PARAMS : []),
      ...redactQueryParams,
    ]),
    redactPatterns: redactPatterns.map((pattern) =>
      pattern instanceof RegExp ? pattern : new RegExp(String(pattern), 'g')
    ),
    redact,
  };
}

/**
 * Apply the caller's patterns and callback to a string.
 *
 * @param {string} value - Text about to be persisted
 * @param {Object} privacy - Normalized privacy options
 * @param {Object} [context] - What the text is, passed to the callback
 * @returns {string} Redacted text
 */
export function redactText(value, privacy, context = {}) {
  if (typeof value !== 'string' || value === '') {
    return value;
  }

  let text = value;
  for (const pattern of privacy.redactPatterns || []) {
    // A caller's regex may be stateful; resetting keeps one trace's output
    // from depending on the previous record's match position.
    pattern.lastIndex = 0;
    text = text.replace(pattern, REDACTED);
  }

  if (privacy.redact) {
    const replaced = privacy.redact({ ...context, value: text });
    if (typeof replaced === 'string') {
      text = replaced;
    }
  }

  return text;
}

/**
 * Redact credentials carried in a URL.
 *
 * `https://user:pass@host/path?token=abc` becomes a URL that still identifies
 * the page without handing over the session it belonged to.
 *
 * @param {string} url - URL about to be persisted
 * @param {Object} privacy - Normalized privacy options
 * @returns {string} Redacted URL
 */
export function redactUrl(url, privacy) {
  if (typeof url !== 'string' || url === '') {
    return url;
  }

  let text = url;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? REDACTED : '';
      parsed.password = parsed.password ? REDACTED : '';
    }
    for (const key of [...parsed.searchParams.keys()]) {
      if (privacy.redactQueryParams.includes(key.toLowerCase())) {
        parsed.searchParams.set(key, REDACTED);
      }
    }
    if (parsed.hash) {
      // Implicit OAuth flows put the token in the fragment.
      const fragment = new URLSearchParams(parsed.hash.slice(1));
      let changed = false;
      for (const key of [...fragment.keys()]) {
        if (privacy.redactQueryParams.includes(key.toLowerCase())) {
          fragment.set(key, REDACTED);
          changed = true;
        }
      }
      if (changed) {
        parsed.hash = `#${fragment.toString()}`;
      }
    }
    // `URL` percent-encodes whatever it is given, so the marker is put back
    // in readable form: a trace is read by people.
    text = parsed.toString().split(encodeURIComponent(REDACTED)).join(REDACTED);
  } catch {
    // A relative or malformed URL is still worth keeping, just unparsed.
  }

  return redactText(text, privacy, { kind: 'url' });
}

/**
 * Redact a header or attribute map.
 *
 * @param {Object} headers - Header name/value pairs
 * @param {Object} privacy - Normalized privacy options
 * @returns {Object} Map with sensitive values replaced
 */
export function redactHeaders(headers, privacy) {
  if (!headers || typeof headers !== 'object') {
    return headers;
  }

  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    result[name] = privacy.redactAttributes.includes(name.toLowerCase())
      ? REDACTED
      : redactText(String(value), privacy, { kind: 'header', name });
  }
  return result;
}

/**
 * Redact every string in an event payload.
 *
 * Applied to whatever a caller or engine put in an event, because a trace is
 * only as private as its least careful field.
 *
 * @param {*} value - Any JSON-compatible value
 * @param {Object} privacy - Normalized privacy options
 * @param {string} [key] - Field name the value was found under
 * @returns {*} The value with strings redacted
 */
export function redactValue(value, privacy, key = '') {
  if (typeof value === 'string') {
    if (privacy.redactAttributes.includes(key.toLowerCase())) {
      return REDACTED;
    }
    return /url$/i.test(key)
      ? redactUrl(value, privacy)
      : redactText(value, privacy, { kind: 'field', name: key });
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, privacy, key));
  }
  if (value && typeof value === 'object') {
    const result = {};
    for (const [name, entry] of Object.entries(value)) {
      result[name] = redactValue(entry, privacy, name);
    }
    return result;
  }
  return value;
}
