import { ProcessRunner } from 'command-stream/process-runner';

/** Start an explicitly persistent process, with no parent-owned pipes or signal forwarding. */
export async function startDetachedProcess(file, args = [], options = {}) {
  const runner = runnerFor(file, args, { ...options, capture: false });
  runner.start();
  await new Promise((resolve, reject) => {
    runner.child.once('spawn', resolve);
    runner.child.once('error', reject);
  });
  const child = runner.child;
  // command-stream 1.x starts noninteractive children in their own process
  // group. Release its controller-owned cancellation registry while retaining
  // the child's exit listeners. Keep this adapter isolated until it exposes a
  // public detach operation; normal subprocesses retain managed cancellation.
  runner._child = null;
  runner._abortController = null;
  runner.finished = true;
  runner._cleanup();
  Promise.resolve(runner).catch(() => {});
  child.stderrTail = '';
  child.stderr?.on('data', (chunk) => {
    child.stderrTail = (child.stderrTail + String(chunk)).slice(-8192);
  });
  child.on('error', (error) => {
    child.spawnError = error;
  });
  child.unref();
  child.stdout?.unref?.();
  child.stderr?.unref?.();
  child.stdin?.unref?.();
  return child;
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
 * @param {string} file - Executable path
 * @param {string[]} args - Exact arguments
 * @param {Object} [options]
 * @param {Object<string,string>} [options.env] - Environment for the child only
 * @param {boolean} [options.forwardOutput=false] - Mirror the child's output to this process
 * @param {number} [options.killGrace=2000] - Milliseconds between SIGTERM and SIGKILL
 * @returns {ManagedProcess}
 */
export function startProcess(file, args = [], options = {}) {
  const { env, cwd, forwardOutput = false, killGrace = 2000 } = options;
  const runner = runnerFor(file, args, { env, cwd, killGrace, capture: false });
  return new ManagedProcess(runner, { forwardOutput });
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
  constructor(runner, { forwardOutput }) {
    this.runner = runner;
    this.exitCode = null;
    this.signalCode = null;
    this.stderrTail = '';
    this.spawnError = null;
    this.stdout = new OutputChannel();
    this.stderr = new OutputChannel();
    this.exitListeners = new Set();
    runner.on('stdout', (chunk) => {
      if (forwardOutput) {
        process.stdout.write(chunk);
      }
      this.stdout.emit(chunk);
    });
    runner.on('stderr', (chunk) => {
      this.stderrTail = (this.stderrTail + String(chunk)).slice(-8192);
      if (forwardOutput) {
        process.stderr.write(chunk);
      }
      this.stderr.emit(chunk);
    });
    runner.start();
    this.exited = Promise.resolve(runner)
      .catch((error) => {
        this.spawnError = error;
        return { code: error?.code ?? 1 };
      })
      .then((result) => {
        this.exitCode = typeof result.code === 'number' ? result.code : 1;
        this.signalCode = result.signal ?? null;
        for (const listener of this.exitListeners) {
          listener(this.exitCode);
        }
        return this.exitCode;
      });
  }

  /** Operating system process id, once spawned. */
  get pid() {
    return this.runner.pid;
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
    if (this.exitCode !== null) {
      return false;
    }
    this.runner.kill(signal);
    return true;
  }
}
