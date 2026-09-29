/**
 * Entry point of the `browser-commander` CLI (issue #104).
 *
 * Every command writes exactly one JSON document to stdout. Exit codes: 0
 * success, 1 error, 2 `doctor` found an unlisted difference, 64 usage error.
 */
import { parseCommandLine, UsageError } from './args.js';
import { COMMAND_HANDLERS } from './commands.js';
import { describeError, RPC_ERROR, RpcError } from './rpc-error.js';

/** Process exit codes. */
export const EXIT_CODES = Object.freeze({
  OK: 0,
  ERROR: 1,
  UNLISTED_DIFFERENCE: 2,
  USAGE: 64,
});

function isUsageError(error) {
  return (
    error instanceof UsageError ||
    (error instanceof RpcError && error.code === RPC_ERROR.INVALID_PARAMS)
  );
}

/**
 * Run the CLI.
 *
 * @param {string[]} argv - Arguments after the program name
 * @param {Object} [io]
 * @param {{write: function(string): unknown}} [io.stdout=process.stdout]
 * @param {Object} [io.stdin=process.stdin]
 * @param {Object} [io.signals=process] - Emits SIGINT/SIGTERM
 * @param {Object} [io.dependencies] - Dispatcher dependencies (tests)
 * @returns {Promise<number>} The exit code
 */
export async function runCli(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const write = (text) => stdout.write(text);
  const print = (document) => write(`${JSON.stringify(document)}\n`);
  const context = {
    write,
    print,
    stdin: io.stdin ?? process.stdin,
    signals: io.signals ?? process,
    dependencies: io.dependencies,
  };
  try {
    const parsed = parseCommandLine(argv);
    const { document, exitCode } = await COMMAND_HANDLERS[parsed.command](
      parsed,
      context
    );
    if (document !== null) {
      print(document);
    }
    return exitCode;
  } catch (error) {
    const usage = isUsageError(error);
    print({
      error: usage
        ? { name: 'UsageError', message: error.message }
        : describeError(error),
    });
    return usage ? EXIT_CODES.USAGE : EXIT_CODES.ERROR;
  }
}
