import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const TEST_FILE_PATTERN = /\.test\.[cm]?js$/u;

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];

  if (!value || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value`);
  }

  return value;
}

function parseEnvAssignment(assignment) {
  const separatorIndex = assignment.indexOf('=');

  if (separatorIndex <= 0) {
    throw new Error(`Invalid environment override: ${assignment}`);
  }

  return {
    name: assignment.slice(0, separatorIndex),
    value: assignment.slice(separatorIndex + 1),
  };
}

export function parseTestRunnerArgs(argv) {
  const options = {
    coverage: false,
    env: {},
    reporter: null,
    targets: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--coverage') {
      options.coverage = true;
      continue;
    }

    if (arg === '--reporter') {
      options.reporter = readOptionValue(argv, index, '--reporter');
      index += 1;
      continue;
    }

    if (arg === '--env') {
      const { name, value } = parseEnvAssignment(
        readOptionValue(argv, index, '--env')
      );
      options.env[name] = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--env=')) {
      const { name, value } = parseEnvAssignment(arg.slice('--env='.length));
      options.env[name] = value;
      continue;
    }

    options.targets.push(arg);
  }

  if (options.targets.length === 0) {
    throw new Error('At least one test file or directory is required');
  }

  return options;
}

function normalizeForSort(filePath) {
  return filePath.split(sep).join('/');
}

function isTestFile(filePath) {
  return TEST_FILE_PATTERN.test(filePath);
}

function listFilesRecursively(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(entryPath));
      continue;
    }

    if (entry.isFile() && isTestFile(entryPath)) {
      files.push(entryPath);
    }
  }

  return files;
}

export function resolveTestFiles(targets, cwd = process.cwd()) {
  const files = [];

  for (const target of targets) {
    const absoluteTarget = resolve(cwd, target);

    if (!existsSync(absoluteTarget)) {
      throw new Error(`Test target does not exist: ${target}`);
    }

    const targetStats = statSync(absoluteTarget);

    if (targetStats.isDirectory()) {
      files.push(...listFilesRecursively(absoluteTarget));
      continue;
    }

    if (targetStats.isFile() && isTestFile(absoluteTarget)) {
      files.push(absoluteTarget);
    }
  }

  const uniqueFiles = [...new Set(files)];
  uniqueFiles.sort((left, right) =>
    normalizeForSort(left).localeCompare(normalizeForSort(right))
  );

  if (uniqueFiles.length === 0) {
    throw new Error(`No test files found in: ${targets.join(', ')}`);
  }

  return uniqueFiles.map((file) => relative(cwd, file));
}

export function buildNodeTestArgs(options, testFiles) {
  const args = ['--test'];

  if (options.coverage) {
    args.push('--experimental-test-coverage');
  }

  if (options.reporter) {
    args.push('--test-reporter', options.reporter);
  }

  args.push(...testFiles);
  return args;
}

function runNodeTests(options, testFiles) {
  const result = spawnSync(
    process.execPath,
    buildNodeTestArgs(options, testFiles),
    {
      env: { ...process.env, ...options.env },
      stdio: 'inherit',
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.signal) {
    throw new Error(`Node test runner terminated by signal ${result.signal}`);
  }

  return result.status ?? 1;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseTestRunnerArgs(argv);
  const testFiles = resolveTestFiles(options.targets);
  return runNodeTests(options, testFiles);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
