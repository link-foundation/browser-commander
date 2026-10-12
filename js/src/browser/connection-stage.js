/** Identify attachment failures; optional logs contain stage names and timings. */
export async function connectionStage(options, stage, work) {
  const start = performance.now();
  const report = (state) => {
    if (options.verbose) {
      console.log(
        `Browser attachment ${stage} ${state} after ${Math.round(performance.now() - start)}ms`
      );
    }
  };
  report('started');
  try {
    const result = await work();
    report('completed');
    return result;
  } catch (error) {
    if (error && typeof error === 'object' && Object.isExtensible(error)) {
      error.attachmentStage ??= stage;
    }
    report('failed');
    throw error;
  }
}
