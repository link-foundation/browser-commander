/**
 * Browser Commander environment probe.
 *
 * The whole file is one expression that evaluates to an async function. Callers
 * wrap it as `(<file contents>)()` so the same bytes work through
 * `page.evaluate`, `Runtime.evaluate` with `awaitPromise`, Selenium's
 * `execute_async_script`, and a plain `<script>` tag in a page loaded by a
 * browser that nothing is automating.
 *
 * The report must be deterministic for a given browser build and machine: no
 * timings, no random values, no wall-clock dependent fields. Anything that
 * legitimately differs between two runs belongs in the caller's ignore list,
 * not in this file.
 */
async function collectBrowserCommanderEnvironmentReport() {
  const report = {};
  const errors = {};

  const record = (section, producer) => {
    try {
      report[section] = producer();
    } catch (error) {
      report[section] = null;
      errors[section] = String((error && error.message) || error);
    }
  };

  const recordAsync = async (section, producer) => {
    try {
      report[section] = await producer();
    } catch (error) {
      report[section] = null;
      errors[section] = String((error && error.message) || error);
    }
  };

  /** Stable, order-independent digest so large blobs stay comparable. */
  const digest = (value) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
      h2 = Math.imul(h2 + code + index, 0x85ebca6b) >>> 0;
    }
    return `${h1.toString(16)}-${h2.toString(16)}`;
  };

  const isNativeFunction = (fn) => {
    try {
      return /\{\s*\[native code\]\s*\}/u.test(Function.prototype.toString.call(fn));
    } catch (error) {
      return `error:${String((error && error.message) || error)}`;
    }
  };

  const descriptorShape = (object, key) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor) {
      return null;
    }
    return {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      hasGet: typeof descriptor.get === 'function',
      hasSet: typeof descriptor.set === 'function',
      getIsNative: descriptor.get ? isNativeFunction(descriptor.get) : null,
      isValue: 'value' in descriptor,
      valueType: 'value' in descriptor ? typeof descriptor.value : null,
      writable: descriptor.writable === undefined ? null : descriptor.writable,
    };
  };

  record('navigator', () => ({
    appCodeName: navigator.appCodeName,
    appName: navigator.appName,
    appVersion: navigator.appVersion,
    cookieEnabled: navigator.cookieEnabled,
    deviceMemory: navigator.deviceMemory ?? null,
    doNotTrack: navigator.doNotTrack,
    hardwareConcurrency: navigator.hardwareConcurrency,
    language: navigator.language,
    languages: Array.from(navigator.languages || []),
    maxTouchPoints: navigator.maxTouchPoints,
    onLine: navigator.onLine,
    pdfViewerEnabled: navigator.pdfViewerEnabled ?? null,
    platform: navigator.platform,
    product: navigator.product,
    productSub: navigator.productSub,
    userAgent: navigator.userAgent,
    vendor: navigator.vendor,
    vendorSub: navigator.vendorSub,
    webdriver: navigator.webdriver ?? null,
    globalPrivacyControl: navigator.globalPrivacyControl ?? null,
    hasUserActivation: typeof navigator.userActivation === 'object',
    hasBluetooth: 'bluetooth' in navigator,
    hasCredentials: 'credentials' in navigator,
    hasHid: 'hid' in navigator,
    hasKeyboard: 'keyboard' in navigator,
    hasLocks: 'locks' in navigator,
    hasSerial: 'serial' in navigator,
    hasUsb: 'usb' in navigator,
    hasWakeLock: 'wakeLock' in navigator,
    hasWebGpu: 'gpu' in navigator,
    hasXr: 'xr' in navigator,
    keys: Object.getOwnPropertyNames(Object.getPrototypeOf(navigator)).sort(),
    ownKeys: Object.getOwnPropertyNames(navigator).sort(),
  }));

  await recordAsync('userAgentData', async () => {
    const data = navigator.userAgentData;
    if (!data) {
      return null;
    }
    const highEntropy = await data.getHighEntropyValues([
      'architecture',
      'bitness',
      'formFactors',
      'fullVersionList',
      'model',
      'platformVersion',
      'uaFullVersion',
      'wow64',
    ]);
    return {
      brands: (data.brands || []).map((brand) => ({
        brand: brand.brand,
        version: brand.version,
      })),
      mobile: data.mobile,
      platform: data.platform,
      highEntropy,
    };
  });

  record('webdriverDescriptor', () => ({
    onInstance: descriptorShape(navigator, 'webdriver'),
    onPrototype: descriptorShape(Navigator.prototype, 'webdriver'),
  }));

  record('plugins', () => ({
    length: navigator.plugins.length,
    items: Array.from(navigator.plugins).map((plugin) => ({
      description: plugin.description,
      filename: plugin.filename,
      name: plugin.name,
      mimeTypes: Array.from(plugin).map((mimeType) => ({
        description: mimeType.description,
        suffixes: mimeType.suffixes,
        type: mimeType.type,
      })),
    })),
    mimeTypesLength: navigator.mimeTypes.length,
    mimeTypes: Array.from(navigator.mimeTypes).map((mimeType) => ({
      description: mimeType.description,
      suffixes: mimeType.suffixes,
      type: mimeType.type,
    })),
    pluginsIsPluginArray:
      Object.prototype.toString.call(navigator.plugins) === '[object PluginArray]',
    mimeTypesIsMimeTypeArray:
      Object.prototype.toString.call(navigator.mimeTypes) === '[object MimeTypeArray]',
  }));

  record('screen', () => ({
    availHeight: screen.availHeight,
    availLeft: screen.availLeft ?? null,
    availTop: screen.availTop ?? null,
    availWidth: screen.availWidth,
    colorDepth: screen.colorDepth,
    height: screen.height,
    isExtended: screen.isExtended ?? null,
    orientationAngle: screen.orientation ? screen.orientation.angle : null,
    orientationType: screen.orientation ? screen.orientation.type : null,
    pixelDepth: screen.pixelDepth,
    width: screen.width,
  }));

  record('window', () => ({
    devicePixelRatio: window.devicePixelRatio,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    outerHeight: window.outerHeight,
    outerWidth: window.outerWidth,
    screenLeft: window.screenLeft,
    screenTop: window.screenTop,
    screenX: window.screenX,
    screenY: window.screenY,
    chromeKeys: window.chrome ? Object.keys(window.chrome).sort() : null,
    hasChrome: 'chrome' in window,
    chromeRuntimeType: window.chrome ? typeof window.chrome.runtime : null,
    chromeCsiType: window.chrome ? typeof window.chrome.csi : null,
    chromeLoadTimesType: window.chrome ? typeof window.chrome.loadTimes : null,
    chromeAppType: window.chrome ? typeof window.chrome.app : null,
    barsVisible: {
      locationbar: window.locationbar.visible,
      menubar: window.menubar.visible,
      personalbar: window.personalbar.visible,
      scrollbars: window.scrollbars.visible,
      statusbar: window.statusbar.visible,
      toolbar: window.toolbar.visible,
    },
    /** Injected automation bindings show up as extra own properties here. */
    suspiciousGlobals: Object.getOwnPropertyNames(window)
      .filter((name) =>
        /^(cdc_|\$cdc|__driver|__webdriver|__selenium|__fxdriver|__nightmare|_Selenium|_phantom|callPhantom|domAutomation|puppeteer|playwright|__playwright|__pw|__puppeteer)/iu.test(
          name
        )
      )
      .sort(),
    documentKeys: Object.getOwnPropertyNames(document)
      .filter((name) => /^(\$cdc|cdc_|__|_Selenium)/u.test(name))
      .sort(),
  }));

  record('viewportRelation', () => ({
    outerMinusInnerHeightIsZero: window.outerHeight - window.innerHeight === 0,
    outerWidthIsZero: window.outerWidth === 0,
    outerHeightIsZero: window.outerHeight === 0,
  }));

  record('intl', () => {
    const dateTime = Intl.DateTimeFormat().resolvedOptions();
    const number = Intl.NumberFormat().resolvedOptions();
    const collator = Intl.Collator().resolvedOptions();
    return {
      dateTimeCalendar: dateTime.calendar,
      dateTimeLocale: dateTime.locale,
      dateTimeNumberingSystem: dateTime.numberingSystem,
      dateTimeTimeZone: dateTime.timeZone,
      collatorLocale: collator.locale,
      numberLocale: number.locale,
      numberNumberingSystem: number.numberingSystem,
      timezoneOffsetJanuary: new Date(Date.UTC(2020, 0, 1)).getTimezoneOffset(),
      timezoneOffsetJuly: new Date(Date.UTC(2020, 6, 1)).getTimezoneOffset(),
      fixedDateString: new Date(Date.UTC(2020, 0, 1, 12)).toString(),
      fixedDateLocaleString: new Date(Date.UTC(2020, 0, 1, 12)).toLocaleString(),
      supportedLocalesEnUs: Intl.DateTimeFormat.supportedLocalesOf(['en-US']),
    };
  });

  record('mediaQueries', () => {
    const queries = [
      '(prefers-color-scheme: dark)',
      '(prefers-color-scheme: light)',
      '(prefers-reduced-motion: reduce)',
      '(prefers-reduced-transparency: reduce)',
      '(prefers-contrast: more)',
      '(forced-colors: active)',
      '(inverted-colors: inverted)',
      '(any-hover: hover)',
      '(any-pointer: fine)',
      '(any-pointer: coarse)',
      '(hover: hover)',
      '(pointer: fine)',
      '(pointer: coarse)',
      '(display-mode: browser)',
      '(color-gamut: srgb)',
      '(dynamic-range: high)',
      '(update: fast)',
      '(scripting: enabled)',
    ];
    const result = {};
    for (const query of queries) {
      result[query] = window.matchMedia(query).matches;
    }
    return result;
  });

  record('css', () => {
    const probeElement = document.createElement('div');
    probeElement.style.cssText =
      'position:absolute;left:-9999px;font-family:monospace;font-size:16px;';
    probeElement.textContent = 'BrowserCommander parity 0123456789';
    document.documentElement.appendChild(probeElement);
    const computed = window.getComputedStyle(probeElement);
    const rect = probeElement.getBoundingClientRect();
    const measurement = {
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      height: Math.round(rect.height * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
    };
    probeElement.remove();
    return measurement;
  });

  record('fonts', () => {
    const families = [
      'Arial',
      'Courier New',
      'DejaVu Sans',
      'Georgia',
      'Helvetica',
      'Liberation Sans',
      'Times New Roman',
      'Ubuntu',
      'Verdana',
    ];
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const widths = {};
    for (const family of families) {
      context.font = `16px "${family}", monospace`;
      widths[family] = Math.round(context.measureText('mmmmmmmmmmlli').width * 100) / 100;
    }
    return {
      widths,
      checks: families.reduce((accumulator, family) => {
        accumulator[family] = document.fonts.check(`16px "${family}"`);
        return accumulator;
      }, {}),
    };
  });

  record('canvas2d', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 60;
    const context = canvas.getContext('2d');
    context.textBaseline = 'top';
    context.font = '14px "Arial"';
    context.fillStyle = '#f60';
    context.fillRect(0, 0, 100, 20);
    context.fillStyle = '#069';
    context.fillText('BrowserCommander 0123456789', 2, 15);
    context.fillStyle = 'rgba(102, 204, 0, 0.7)';
    context.fillText('BrowserCommander 0123456789', 4, 25);
    context.globalCompositeOperation = 'multiply';
    context.beginPath();
    context.arc(50, 50, 20, 0, Math.PI * 2, true);
    context.fill();
    return {
      dataUrlDigest: digest(canvas.toDataURL()),
      textMetricsWidth:
        Math.round(context.measureText('BrowserCommander').width * 100) / 100,
    };
  });

  record('webgl', () => {
    const canvas = document.createElement('canvas');
    const collect = (contextName) => {
      const gl = canvas.getContext(contextName, { failIfMajorPerformanceCaveat: false });
      if (!gl) {
        return null;
      }
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const parameterNames = [
        'MAX_TEXTURE_SIZE',
        'MAX_VIEWPORT_DIMS',
        'MAX_RENDERBUFFER_SIZE',
        'MAX_VERTEX_ATTRIBS',
        'MAX_VARYING_VECTORS',
        'MAX_VERTEX_UNIFORM_VECTORS',
        'MAX_FRAGMENT_UNIFORM_VECTORS',
        'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
        'MAX_CUBE_MAP_TEXTURE_SIZE',
        'ALIASED_LINE_WIDTH_RANGE',
        'ALIASED_POINT_SIZE_RANGE',
        'RED_BITS',
        'GREEN_BITS',
        'BLUE_BITS',
        'ALPHA_BITS',
        'DEPTH_BITS',
        'STENCIL_BITS',
      ];
      const parameters = {};
      for (const name of parameterNames) {
        if (gl[name] === undefined) {
          continue;
        }
        const value = gl.getParameter(gl[name]);
        parameters[name] = ArrayBuffer.isView(value) ? Array.from(value) : value;
      }
      return {
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION),
        shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        unmaskedVendor: debugInfo
          ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
          : null,
        unmaskedRenderer: debugInfo
          ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
          : null,
        extensions: (gl.getSupportedExtensions() || []).slice().sort(),
        parameters,
        contextAttributes: gl.getContextAttributes(),
      };
    };
    return { webgl1: collect('webgl'), webgl2: collect('webgl2') };
  });

  await recordAsync('audio', async () => {
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineContext) {
      return null;
    }
    const context = new OfflineContext(1, 5000, 44100);
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 10000;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -50;
    compressor.knee.value = 40;
    compressor.ratio.value = 12;
    compressor.attack.value = 0;
    compressor.release.value = 0.25;
    oscillator.connect(compressor);
    compressor.connect(context.destination);
    oscillator.start(0);
    const buffer = await context.startRendering();
    const samples = buffer.getChannelData(0);
    let sum = 0;
    for (let index = 4500; index < 5000; index += 1) {
      sum += Math.abs(samples[index]);
    }
    return {
      sampleRate: context.sampleRate,
      digest: digest(sum.toFixed(8)),
      channelCount: buffer.numberOfChannels,
    };
  });

  record('codecs', () => {
    const video = document.createElement('video');
    const audio = document.createElement('audio');
    const videoTypes = [
      'video/mp4; codecs="avc1.42E01E"',
      'video/mp4; codecs="hev1.1.6.L93.B0"',
      'video/webm; codecs="vp8"',
      'video/webm; codecs="vp9"',
      'video/webm; codecs="av01.0.05M.08"',
      'video/ogg; codecs="theora"',
    ];
    const audioTypes = [
      'audio/mpeg',
      'audio/mp4; codecs="mp4a.40.2"',
      'audio/ogg; codecs="vorbis"',
      'audio/ogg; codecs="opus"',
      'audio/wav; codecs="1"',
      'audio/aac',
      'audio/flac',
    ];
    const result = { video: {}, audio: {} };
    for (const type of videoTypes) {
      result.video[type] = video.canPlayType(type);
    }
    for (const type of audioTypes) {
      result.audio[type] = audio.canPlayType(type);
    }
    return result;
  });

  await recordAsync('permissions', async () => {
    const names = [
      'accelerometer',
      'camera',
      'clipboard-read',
      'geolocation',
      'microphone',
      'midi',
      'notifications',
      'persistent-storage',
    ];
    const states = {};
    for (const name of names) {
      try {
        const status = await navigator.permissions.query({ name });
        states[name] = status.state;
      } catch (error) {
        states[name] = `error:${String((error && error.message) || error)}`;
      }
    }
    return {
      states,
      notificationPermission:
        typeof Notification === 'undefined' ? null : Notification.permission,
      /** Headless Chrome historically reported denied here but default above. */
      notificationsMismatch:
        typeof Notification !== 'undefined' &&
        states.notifications === 'prompt' &&
        Notification.permission === 'denied',
    };
  });

  await recordAsync('mediaDevices', async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return null;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const kinds = {};
    for (const device of devices) {
      kinds[device.kind] = (kinds[device.kind] || 0) + 1;
    }
    return { count: devices.length, kinds };
  });

  record('connection', () => {
    const connection =
      navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) {
      return null;
    }
    return {
      downlink: connection.downlink,
      effectiveType: connection.effectiveType,
      rtt: connection.rtt,
      saveData: connection.saveData,
      type: connection.type ?? null,
    };
  });

  await recordAsync('battery', async () => {
    if (typeof navigator.getBattery !== 'function') {
      return null;
    }
    const battery = await navigator.getBattery();
    return {
      charging: battery.charging,
      chargingTime: battery.chargingTime,
      dischargingTime: battery.dischargingTime,
      level: battery.level,
    };
  });

  record('speech', () => {
    if (typeof speechSynthesis === 'undefined') {
      return null;
    }
    const voices = speechSynthesis.getVoices();
    return {
      count: voices.length,
      names: voices.map((voice) => `${voice.name}|${voice.lang}|${voice.default}`).sort(),
    };
  });

  record('errors', () => {
    const error = new Error('browser-commander-parity');
    const stackLines = String(error.stack || '').split('\n').length;
    let asyncStackLines = null;
    try {
      null.property();
    } catch (typeError) {
      asyncStackLines = String(typeError.stack || '').split('\n').length;
    }
    return {
      stackLines,
      asyncStackLines,
      hasCaptureStackTrace: typeof Error.captureStackTrace === 'function',
      stackTraceLimit: Error.stackTraceLimit,
      prepareStackTraceType: typeof Error.prepareStackTrace,
      messageFirstLine: String(error.stack || '').split('\n')[0],
    };
  });

  record('nativeFunctions', () => {
    const targets = {
      'navigator.permissions.query': navigator.permissions && navigator.permissions.query,
      'navigator.plugins.item': navigator.plugins.item,
      'navigator.mediaDevices.enumerateDevices':
        navigator.mediaDevices && navigator.mediaDevices.enumerateDevices,
      'HTMLCanvasElement.toDataURL': HTMLCanvasElement.prototype.toDataURL,
      'CanvasRenderingContext2D.getImageData':
        CanvasRenderingContext2D.prototype.getImageData,
      'WebGLRenderingContext.getParameter': WebGLRenderingContext.prototype.getParameter,
      'Function.prototype.toString': Function.prototype.toString,
      'Object.getOwnPropertyDescriptor': Object.getOwnPropertyDescriptor,
      'Reflect.get': Reflect.get,
      'Date.prototype.getTimezoneOffset': Date.prototype.getTimezoneOffset,
      'Intl.DateTimeFormat': Intl.DateTimeFormat,
    };
    const result = {};
    for (const [name, fn] of Object.entries(targets)) {
      result[name] = fn ? isNativeFunction(fn) : null;
    }
    return result;
  });

  record('iframe', () => {
    const frame = document.createElement('iframe');
    frame.style.display = 'none';
    document.documentElement.appendChild(frame);
    const contentWindow = frame.contentWindow;
    const measurement = {
      hasContentWindow: Boolean(contentWindow),
      webdriver: contentWindow ? (contentWindow.navigator.webdriver ?? null) : null,
      hardwareConcurrency: contentWindow
        ? contentWindow.navigator.hardwareConcurrency
        : null,
      languages: contentWindow ? Array.from(contentWindow.navigator.languages || []) : null,
      platform: contentWindow ? contentWindow.navigator.platform : null,
      userAgent: contentWindow ? contentWindow.navigator.userAgent : null,
      hasChrome: contentWindow ? 'chrome' in contentWindow : null,
      pluginsLength: contentWindow ? contentWindow.navigator.plugins.length : null,
    };
    frame.remove();
    return measurement;
  });

  record('document', () => ({
    characterSet: document.characterSet,
    compatMode: document.compatMode,
    contentType: document.contentType,
    designMode: document.designMode,
    hidden: document.hidden,
    referrer: document.referrer,
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    bodyClientHeightIsPositive: document.body ? document.body.clientHeight > 0 : null,
  }));

  await recordAsync('webgpu', async () => {
    if (!navigator.gpu) {
      return null;
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return { hasAdapter: false };
    }
    return {
      hasAdapter: true,
      features: Array.from(adapter.features || []).sort(),
      isFallbackAdapter: adapter.isFallbackAdapter ?? null,
    };
  });

  record('storage', () => ({
    localStorageAvailable: (() => {
      try {
        window.localStorage.setItem('__bc_probe__', '1');
        window.localStorage.removeItem('__bc_probe__');
        return true;
      } catch (error) {
        return String((error && error.message) || error);
      }
    })(),
    indexedDbAvailable: typeof indexedDB !== 'undefined',
    hasStorageEstimate: Boolean(navigator.storage && navigator.storage.estimate),
  }));

  report.probeErrors = errors;
  return report;
}
