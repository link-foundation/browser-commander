/** Release resources when startup fails before returning a running trace. */
export async function abortTraceStart(resources) {
  const { detachers, detachNetwork, video, mutations, linksSink, bundle } =
    resources;
  for (const detach of detachers.reverse()) {
    await Promise.resolve()
      .then(detach)
      .catch(() => {});
  }
  await detachNetwork().catch(() => {});
  await video?.stop().catch(() => {});
  await mutations.stop().catch(() => {});
  await linksSink?.discard().catch(() => {});
  await bundle.abort();
}
