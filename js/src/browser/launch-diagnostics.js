/** Bounded launch evidence with a stable contract independent of engine text. */
export class BrowserLaunchError extends Error {
  constructor({
    phase,
    engine,
    category,
    exitCode = null,
    signal = null,
    stderrTail = '',
    cause,
  }) {
    super(
      `Browser launch failed (${phase}: ${category}): ${stderrTail || cause?.message || ''}`,
      { cause }
    );
    this.name = 'BrowserLaunchError';
    Object.assign(this, {
      phase,
      engine,
      category,
      exitCode,
      signal,
      stderrTail,
    });
  }
}

/** Remove paths, URL credentials/query strings and common secret assignments. */
export function redactLaunchEvidence(value, redactor) {
  let text = String(value ?? '')
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/giu, '[url]')
    .replace(/(?:[A-Za-z]:\\|\/)(?:[^\s:;"'<>]+)/gu, '[path]')
    .replace(
      /\b(token|password|secret|authorization|cookie)\s*[=:]\s*[^\s,;]+/giu,
      '$1=[redacted]'
    );
  if (redactor) {
    try {
      text = String(redactor(text));
    } catch {
      text = '[diagnostic redaction failed]';
    }
  }
  const bytes = Buffer.from(text, 'utf8');
  let start = Math.max(0, bytes.length - 4096);
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) {
    start++;
  }
  return bytes.subarray(start).toString('utf8');
}

export function launchFailure(
  cause,
  {
    phase,
    engine = 'playwright',
    browserProcess,
    diagnosticRedactor,
    executablePath,
    userDataDir,
  } = {}
) {
  if (cause instanceof BrowserLaunchError) {
    return cause;
  }
  const raw = String(cause?.message ?? cause);
  const category =
    cause?.code === 'ENOENT' ||
    /not found|does not exist|not an executable|not accessible|could not find an installed|no .*executable/i.test(
      raw
    )
      ? 'missing_executable'
      : cause?.name === 'PortRaceError'
        ? 'port_race'
        : /timed out|timeout/i.test(raw)
          ? 'startup_timeout'
          : browserProcess?.exitCode !== null &&
              browserProcess?.exitCode !== undefined
            ? 'early_exit'
            : 'configuration';
  const scrub = (value) => {
    let text = String(value ?? '');
    for (const sensitive of [executablePath, userDataDir]) {
      if (sensitive) {
        text = text.replaceAll(sensitive, '[path]');
      }
    }
    return redactLaunchEvidence(text, diagnosticRedactor);
  };
  const safeCause = new Error(scrub(raw));
  safeCause.name = cause?.name ?? 'Error';
  safeCause.code = cause?.code;
  return new BrowserLaunchError({
    phase,
    engine,
    category,
    exitCode: browserProcess?.exitCode ?? null,
    signal: browserProcess?.signalCode ?? null,
    stderrTail: scrub(browserProcess?.stderrTail ?? cause?.stderrTail ?? ''),
    cause: safeCause,
  });
}
