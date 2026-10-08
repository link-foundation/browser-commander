/** Register a callback and return a remover that can safely be called again. */
export function subscribeCallbacks(callbacks, callback) {
  callbacks?.push(callback);
  let removed = false;
  return () => {
    if (removed) {
      return;
    }
    removed = true;
    removeCallback(callbacks, callback);
  };
}

/** Remove one matching callback, retaining other registrations. */
export function removeCallback(callbacks, callback) {
  const index = callbacks?.indexOf(callback) ?? -1;
  if (index !== -1) {
    callbacks.splice(index, 1);
  }
}
