/** Serialize background drains and wait for the active drain during teardown. */
export function startTraceDrain({
  mutations,
  userActions,
  captureState,
  note,
}) {
  let task;
  const timer = setInterval(() => {
    if (!task) {
      task = Promise.resolve()
        .then(() => userActions.drain())
        .then(() => mutations.drain(captureState.index))
        .catch((error) => note(error.message))
        .finally(() => {
          task = null;
        });
    }
  }, 500);
  timer.unref?.();
  return async () => {
    clearInterval(timer);
    await task;
  };
}
