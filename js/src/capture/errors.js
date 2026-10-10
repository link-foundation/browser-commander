/** A requested capture capability is unavailable on this engine or codec. */
export class UnsupportedCaptureError extends Error {
  constructor(capability, engine, cause) {
    super(`Capture capability "${capability}" is unavailable on ${engine}`, {
      cause,
    });
    this.name = 'UnsupportedCaptureError';
    this.code = 'UNSUPPORTED_CAPTURE';
    this.capability = capability;
    this.engine = engine;
  }
}
