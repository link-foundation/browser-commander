import { constants as osConstants } from 'node:os';
import { ProcessRunner } from 'command-stream/process-runner';

/** Start an explicitly persistent process, with no parent-owned pipes or signal forwarding. */
export async function startDetachedProcess(file, args = [], options = {}) {
  const runner = runnerFor(file, args, { ...options, capture: false });
  runner.start();
  await new Promise((resolve, reject) => {
    runner.child.once('spawn', resolve);
    runner.child.once('error', reject);
  });
  const child = releaseRunner(runner);
  Promise.resolve(runner).catch(() => {});
  child.stderrTail = '';
  child.stderr?.on('data', (chunk) => {
    child.stderrTail = (child.stderrTail + String(chunk)).slice(-8192);
  });
  child.on('error', (error) => {
    child.spawnError = error;
  });
  unrefChild(child);
  return child;
}

/**
 * Release a started runner from command-stream's process-wide cancellation
 * registry and return its raw child. command-stream 2.x has no public per-run
 * opt-out: every runner joins a global set whose SIGINT handler forwards the
 * signal to the child's process group. command-stream starts noninteractive
 * children in their own process group, so once released nothing but the caller
 * signals the child. Its exit listeners are retained.
 */
function releaseRunner(runner) {
  const child = runner.child;
  runner._child = null;
  runner._abortController = null;
  runner.finished = true;
  runner._cleanup();
  return child;
}

function unrefChild(child) {
  child.unref?.();
  child.stdout?.unref?.();
  child.stderr?.unref?.();
  child.stdin?.unref?.();
}

/** Who answers a terminal interrupt (SIGINT) for a started process. */
export const INTERRUPTION_MODES = Object.freeze(['managed', 'caller']);

/** Validate an `interruption` option, returning the effective mode. */
export function interruptionMode(value = 'managed') {
  if (!INTERRUPTION_MODES.includes(value)) {
    throw new TypeError(
      `interruption must be one of ${INTERRUPTION_MODES.join(', ')}, got ${String(value)}`
    );
  }
  return value;
}

function signalExitCode(signal) {
  return 128 + (osConstants.signals[signal] ?? 1);
}

/** Signal a process and its process group, ignoring an already-gone one. */
export function signalProcessTree(pid, signal) {
  let delivered = false;
  for (const target of process.platform === 'win32' ? [pid] : [-pid, pid]) {
    try {
      process.kill(target, signal);
      delivered = true;
    } catch (error) {
      if (error.code !== 'ESRCH') {
        throw error;
      }
    }
  }
  return delivered;
}

/**
 * Every subprocess Browser Commander starts - browsers, WebDriver servers, the
 * engine bridge, credential tools (`security`, `secret-tool`, `kwallet-query`,
 * `powershell.exe`, `icacls`, `whoami`) and the user's own browser opener -
 * goes through command-stream (issue #104). Its `exec` mode runs the file
 * directly with exact argv boundaries, no shell in between, and gives one
 * consistent surface for streaming output, cancellation and exit codes. The
 * Rust crate uses the `command-stream` crate and the Python package a
 * `subprocess` wrapper with the same two functions.
 *
 * The lightweight `command-stream/process-runner` entry point is used so the
 * optional PTY and terminal-rendering modules are never loaded.
 */

function runnerFor(
  file,
  args,
  { env, cwd, stdin = 'ignore', killGrace, capture = true }
) {
  return new ProcessRunner(
    { mode: 'exec', file, args },
    {
      mirror: false,
      capture,
      stdin,
      ...(env ? { env } : {}),
      ...(cwd ? { cwd } : {}),
      ...(killGrace === undefined ? {} : { killGrace }),
    }
  );
}

/** Error raised when a command exits with a non-zero status. */
export class CommandError extends Error {
  constructor(file, args, result) {
    const stderr = String(result.stderr ?? '').trim();
    super(
      `${file} exited with code ${result.code}${stderr ? `: ${stderr}` : ''}`
    );
    this.name = 'CommandError';
    this.file = file;
    this.args = args;
    this.code = result.code;
    this.exitCode = result.code;
    this.stdout = String(result.stdout ?? '');
    this.stderr = String(result.stderr ?? '');
  }
}

/**
 * Run a command to completion and return its output.
 *
 * @param {string} file - Executable to run (resolved through PATH)
 * @param {string[]} [args] - Exact arguments
 * @param {Object} [options]
 * @param {Object<string,string>} [options.env] - Environment for the child only
 * @param {string} [options.cwd] - Working directory
 * @param {string|Buffer} [options.input] - Data written to the child's stdin
 * @param {boolean} [options.check=true] - Throw {@link CommandError} on a non-zero exit
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
export async function runCommand(file, args = [], options = {}) {
  const { env, cwd, input, check = true } = options;
  const runner = runnerFor(file, args, {
    env,
    cwd,
    stdin: input === undefined ? 'ignore' : input,
  });
  let result;
  try {
    result = await runner;
  } catch (error) {
    // A missing executable fails the spawn itself; report it like execFile.
    if (error && error.code === undefined) {
      error.code = 'ENOENT';
    }
    throw error;
  }
  const normalized = {
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    code: result.code,
  };
  if (check && normalized.code !== 0) {
    throw new CommandError(file, args, normalized);
  }
  return normalized;
}

/**
 * Start a long-running process, such as a browser or a driver server.
 *
 * The returned handle has the part of the `ChildProcess` surface the launchers
 * rely on (`pid`, `exitCode`, `kill()`, `stderr`/`stdout` `data` events and an
 * `exit` event), plus an `exited` promise.
 *
 * By default (`interruption: 'managed'`) command-stream owns interruption: its
 * process-wide SIGINT handler forwards Ctrl+C to the child's process group.
 * With `interruption: 'caller'` the child is released from that registry right
 * after it starts, so the embedding program's own SIGINT handler decides
 * whether to stop, detach or keep the child (issue #174). Output streaming,
 * `exited`, and `kill()` (which still awaits the actual exit) keep working.
 *
 * @param {string} file - Executable path
 * @param {string[]} args - Exact arguments
 * @param {Object} [options]
 * @param {Object<string,string>} [options.env] - Environment for the child only
 * @param {boolean} [options.forwardOutput=false] - Mirror the child's output to this process
 * @param {number} [options.killGrace=2000] - Milliseconds between SIGTERM and SIGKILL
 * @param {'managed'|'caller'} [options.interruption='managed'] - Who answers SIGINT
 * @returns {ManagedProcess}
 */
export function startProcess(file, args = [], options = {}) {
  const { env, cwd, forwardOutput = false, killGrace = 2000 } = options;
  const interruption = interruptionMode(options.interruption);
  const runner = runnerFor(file, args, { env, cwd, killGrace, capture: false });
  return new ManagedProcess(runner, { forwardOutput, killGrace, interruption });
}

class OutputChannel {
  constructor() {
    this.listeners = new Set();
  }

  on(event, listener) {
    if (event === 'data') {
      this.listeners.add(listener);
    }
    return this;
  }

  off(event, listener) {
    this.listeners.delete(listener);
    return this;
  }

  emit(chunk) {
    for (const listener of this.listeners) {
      listener(chunk);
    }
  }
}

/** Handle for a process started by {@link startProcess}. */
export class ManagedProcess {
  constructor(
    runner,
    { forwardOutput, killGrace = 2000, interruption = 'managed' }
  ) {
    this.runner = runner;
    this.exitCode = null;
    this.signalCode = null;
    this.stderrTail = '';
    this.spawnError = null;
    this.stdout = new OutputChannel();
    this.stderr = new OutputChannel();
    this.exitListeners = new Set();
    this.termination = null;
    this.killGrace = killGrace;
    this.interruption = interruption;
    this.detached = false;
    this.child = null;
    this.forwardOutput = forwardOutput;
    runner.on('stdout', (chunk) => this.receiveStdout(chunk));
    runner.on('stderr', (chunk) => this.receiveStderr(chunk));
    let settle;
    const settled = new Promise((resolve) => {
      settle = resolve;
    });
    this.settle = settle;
    runner.start();
    Promise.resolve(runner).then(
      (result) => {
        // A released runner resolves without a result; its raw child reports.
        if (!this.child) {
          settle(result);
        }
      },
      (error) => {
        this.spawnError = error;
        settle({ code: error?.code ?? 1 });
      }
    );
    this.exited = settled.then(async (result) => {
      const actualExit = await this.termination;
      if (actualExit) {
        result = {
          ...result,
          code: actualExit.code ?? result.code,
          signal: actualExit.signal,
        };
      }
      this.exitCode = typeof result.code === 'number' ? result.code : 1;
      this.signalCode = result.signal ?? null;
      for (const listener of this.exitListeners) {
        listener(this.exitCode);
      }
      return this.exitCode;
    });
    if (interruption === 'caller') {
      this.release();
    }
  }

  receiveStdout(chunk) {
    if (this.forwardOutput) {
      process.stdout.write(chunk);
    }
    this.stdout.emit(chunk);
  }

  receiveStderr(chunk) {
    this.stderrTail = (this.stderrTail + String(chunk)).slice(-8192);
    if (this.forwardOutput) {
      process.stderr.write(chunk);
    }
    this.stderr.emit(chunk);
  }

  /**
   * Take the child out of command-stream's SIGINT forwarding while this handle
   * keeps observing its output and exit.
   */
  release() {
    if (this.exitCode !== null || this.termination) {
      return false;
    }
    if (this.child) {
      return true;
    }
    const child = this.runner.child;
    if (!child?.pid) {
      return false;
    }
    releaseRunner(this.runner);
    this.child = child;
    this.interruption = 'caller';
    child.stdout?.on('data', (chunk) => this.receiveStdout(chunk));
    child.stderr?.on('data', (chunk) => this.receiveStderr(chunk));
    const report = (code, signal) =>
      this.settle({
        code: Number.isInteger(code) ? code : signalExitCode(signal),
        signal: signal ?? null,
      });
    if (Number.isInteger(child.exitCode) || child.signalCode) {
      report(child.exitCode, child.signalCode);
    } else {
      child.once('exit', report);
    }
    return true;
  }

  /**
   * Leave the process running independently of this program: release it from
   * command-stream's SIGINT forwarding and stop its handle and pipes from
   * keeping the event loop alive. Exit observation keeps working while this
   * program runs, and {@link kill} still stops it. Idempotent.
   *
   * @returns {boolean} Whether a running process is now detached
   */
  detach() {
    if (!this.release()) {
      return false;
    }
    this.detached = true;
    unrefChild(this.child);
    return true;
  }

  /** Operating system process id, once spawned. */
  get pid() {
    return this.child?.pid ?? this.runner.pid;
  }

  on(event, listener) {
    if (event === 'exit') {
      if (this.exitCode !== null) {
        listener(this.exitCode);
      } else {
        this.exitListeners.add(listener);
      }
    }
    return this;
  }

  once(event, listener) {
    return this.on(event, listener);
  }

  /**
   * Stop the process: the signal first, then SIGKILL after the grace period.
   *
   * @param {string} [signal='SIGTERM']
   * @returns {boolean} Whether a running process was signalled
   */
  kill(signal) {
    if (this.exitCode !== null || this.termination) {
      return false;
    }
    if (this.child) {
      return this.killReleased(signal ?? 'SIGTERM');
    }
    // command-stream resolves cancellation immediately and removes the child's
    // listeners. Retain its handle and observe the real exit after signalling,
    // so launchers cannot delete profiles while Chrome still writes to them.
    const child = this.runner.child;
    let resolveExit;
    if (child?.pid) {
      this.termination = new Promise((resolve) => {
        resolveExit = resolve;
      });
    }
    this.runner.kill(signal);
    if (resolveExit) {
      if (child.exited) {
        child.exited.then((code) =>
          resolveExit({ code, signal: child.signalCode ?? null })
        );
      } else if (
        Number.isInteger(child.exitCode) ||
        typeof child.signalCode === 'string'
      ) {
        resolveExit({ code: child.exitCode, signal: child.signalCode });
      } else {
        child.once('exit', (code, exitSignal) =>
          resolveExit({ code, signal: exitSignal })
        );
      }
    }
    return true;
  }

  /** Stop a released child directly; command-stream no longer tracks it. */
  killReleased(signal) {
    const { child } = this;
    if (!signalProcessTree(child.pid, signal)) {
      return false;
    }
    if (signal !== 'SIGKILL') {
      const escalation = setTimeout(() => {
        if (this.exitCode === null) {
          signalProcessTree(child.pid, 'SIGKILL');
        }
      }, this.killGrace);
      escalation.unref?.();
      this.exited.then(() => clearTimeout(escalation));
    }
    return true;
  }
}
