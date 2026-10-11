/** Isolate explicit debug policy tests from the runner's environment opt-out. */
export function clearDebugEnvironment() {
  const names = ['BROWSER_COMMANDER_DEBUG', 'BROWSER_COMMANDER_TRACE'];
  const previous = names.map((name) => process.env[name]);
  names.forEach((name) => {
    delete process.env[name];
  });
  return () => {
    names.forEach((name, index) => {
      if (previous[index] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previous[index];
      }
    });
  };
}
