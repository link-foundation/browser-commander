/**
 * Translate a fingerprint profile into CDP `Emulation` commands.
 *
 * These are the overrides Chrome itself enforces. They apply to workers and to
 * outgoing HTTP headers, not only to the main world, which is what makes them
 * strictly better than patching JavaScript properties. Anything that has no
 * command here needs a page init script instead; `limitations.js` records why.
 */

function userAgentMetadata(profile) {
  const data = profile.userAgentData;
  if (!data) {
    return undefined;
  }
  // platform, platformVersion, architecture, model and mobile are required by
  // the protocol; Chrome rejects the command when any of them is missing.
  const metadata = {
    platform: data.platform ?? '',
    platformVersion: data.platformVersion ?? '',
    architecture: data.architecture ?? '',
    model: data.model ?? '',
    mobile: data.mobile ?? false,
  };
  if (data.brands) {
    metadata.brands = data.brands.map((entry) => ({ ...entry }));
  }
  if (data.fullVersionList) {
    metadata.fullVersionList = data.fullVersionList.map((entry) => ({
      ...entry,
    }));
  }
  if (data.bitness !== undefined) {
    metadata.bitness = data.bitness;
  }
  if (data.fullVersion !== undefined) {
    // Deprecated in the protocol, but `fullVersionList` does not cover the
    // `uaFullVersion` hint: without this the page still reads the real Chrome
    // build number. See analysis-artifacts/ua-hints-detail.json.
    metadata.fullVersion = data.fullVersion;
  }
  if (data.wow64 !== undefined) {
    metadata.wow64 = data.wow64;
  }
  if (data.formFactors !== undefined) {
    metadata.formFactors = [...data.formFactors];
  }
  return metadata;
}

function emulatedMediaFeatures(profile) {
  const features = [];
  if (profile.reducedMotion !== undefined) {
    features.push({
      name: 'prefers-reduced-motion',
      value: profile.reducedMotion,
    });
  }
  if (profile.forcedColors !== undefined) {
    features.push({ name: 'forced-colors', value: profile.forcedColors });
  }
  if (profile.colorScheme !== undefined) {
    features.push({ name: 'prefers-color-scheme', value: profile.colorScheme });
  }
  return features;
}

function deviceMetrics(profile) {
  const { viewport, screen } = profile;
  if (!viewport && !screen) {
    return undefined;
  }
  const params = {
    // 0 means "no override" for the viewport, so a profile that only sets
    // screen dimensions still leaves the real window size alone.
    width: viewport?.width ?? 0,
    height: viewport?.height ?? 0,
    deviceScaleFactor: viewport?.deviceScaleFactor ?? 0,
    mobile: viewport?.mobile ?? false,
  };
  if (screen?.width !== undefined) {
    params.screenWidth = screen.width;
    params.screenHeight = screen.height;
  }
  return params;
}

/**
 * Build the ordered CDP command list for a profile.
 *
 * @param {object} profile Normalized fingerprint profile.
 * @returns {Array<{method: string, params: object}>} Commands to send in order.
 */
export function buildCdpEmulationCommands(profile) {
  if (!profile || typeof profile !== 'object') {
    throw new TypeError('profile must be a normalized fingerprint profile');
  }
  const commands = [];

  if (profile.userAgent !== undefined || profile.acceptLanguage !== undefined) {
    const params = {};
    if (profile.userAgent !== undefined) {
      params.userAgent = profile.userAgent;
    }
    if (profile.acceptLanguage !== undefined) {
      params.acceptLanguage = profile.acceptLanguage;
    }
    if (profile.platform !== undefined) {
      params.platform = profile.platform;
    }
    const metadata = userAgentMetadata(profile);
    if (metadata) {
      params.userAgentMetadata = metadata;
    }
    // userAgent is a required parameter even when only the language changes.
    if (params.userAgent === undefined) {
      params.userAgent = '';
    }
    commands.push({ method: 'Emulation.setUserAgentOverride', params });
  }

  if (profile.timezoneId !== undefined) {
    commands.push({
      method: 'Emulation.setTimezoneOverride',
      params: { timezoneId: profile.timezoneId },
    });
  }

  if (profile.locale !== undefined) {
    commands.push({
      method: 'Emulation.setLocaleOverride',
      params: { locale: profile.locale },
    });
  }

  if (profile.hardwareConcurrency !== undefined) {
    commands.push({
      method: 'Emulation.setHardwareConcurrencyOverride',
      params: { hardwareConcurrency: profile.hardwareConcurrency },
    });
  }

  const metrics = deviceMetrics(profile);
  if (metrics) {
    commands.push({
      method: 'Emulation.setDeviceMetricsOverride',
      params: metrics,
    });
  }

  if (profile.maxTouchPoints !== undefined) {
    commands.push({
      method: 'Emulation.setTouchEmulationEnabled',
      params: {
        enabled: profile.maxTouchPoints > 0,
        maxTouchPoints: Math.max(profile.maxTouchPoints, 1),
      },
    });
  }

  const features = emulatedMediaFeatures(profile);
  if (features.length > 0) {
    commands.push({
      method: 'Emulation.setEmulatedMedia',
      params: { features },
    });
  }

  if (profile.geolocation !== undefined) {
    commands.push({
      method: 'Emulation.setGeolocationOverride',
      params: { ...profile.geolocation },
    });
  }

  return commands;
}
