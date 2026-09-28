/**
 * Parity harness for the experiment runners.
 *
 * The probe, the probe server, the hand-started reference capture and the
 * report diff ship with the package (`js/src/parity/`), because
 * `measureParity()` and `browser-commander doctor` use them (issue #103).
 * This module re-exports them and adds the helpers only the runners need.
 */
export {
  captureReferenceReport,
  diffReports,
  probeExpression,
  readProbeSource,
  startProbeServer,
} from '../../js/src/parity/harness.js';

/**
 * Read one value out of a probe report by path.
 *
 * The report is JSON POSTed back by a page, so every level of it can be
 * missing: a browser that failed to run half the probe still sends what it
 * got. Walking the path in a loop keeps the runners free of the long
 * `report?.a?.b ?? null` chains that make a flat projection of twenty fields
 * read as a function with a cyclomatic complexity of fifty.
 *
 * @param {unknown} report the parsed probe report, possibly undefined
 * @param {string[]} keyPath property names, outermost first
 * @param {unknown} [fallback] returned when the path is absent
 * @returns {unknown}
 */
export function readReportPath(report, keyPath, fallback = undefined) {
  let value = report;

  for (const key of keyPath) {
    if (value === null || value === undefined) {
      return fallback;
    }

    value = value[key];
  }

  return value === undefined ? fallback : value;
}

/**
 * Project a probe report into the flat, named shape a runner compares on.
 *
 * @param {unknown} report
 * @param {Record<string, string[]>} paths output name to path in the report
 * @param {unknown} [fallback] value for a path the report does not have
 * @returns {Record<string, unknown>}
 */
export function projectReport(report, paths, fallback = undefined) {
  return Object.fromEntries(
    Object.entries(paths).map(([name, keyPath]) => [
      name,
      readReportPath(report, keyPath, fallback),
    ])
  );
}

/**
 * Chrome forks a zygote, a GPU process and one renderer per tab. Killing only
 * the browser process reparents those children and they keep running, so every
 * capture must take down the whole process group.
 */
export async function killProcessTree(child) {
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
  await exited;
}
