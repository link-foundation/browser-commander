/**
 * Can another language read the Links Notation export? (issue #94)
 *
 * The unit tests format and parse the export with the same JavaScript library,
 * so they would pass even if the emitted text were only readable by the
 * implementation that wrote it. This records a real run with a real browser,
 * writes the export as the run happens, and then hands the file to the Python
 * implementation of the same notation - the version pinned in `js/package.json`
 * - which prints the timeline it parsed. Both printouts have to say the same
 * thing, otherwise "portable" is a claim rather than a fact.
 *
 * Needs `links-notation` for Python: pip install links-notation==0.20.0
 *
 * Run with: node experiments/trace-links-export.mjs [playwright|puppeteer]
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { makeBrowserCommander } from '../js/src/factory.js';
import { TRACE_MODE } from '../js/src/traces/schema.js';
import { launchE2EBrowser } from '../js/tests/helpers/e2e-browser.js';
import { startTraceServer } from '../js/tests/helpers/trace-server.js';

const engine = process.argv[2] ?? 'playwright';

const PYTHON_READER = `
import json
import sys

from links_notation import StreamParser

# The export is line oriented, so a reader can follow a run that is still
# being written. The streaming parser is fed the file in chunks to prove that
# nothing here needs the whole file in memory.
parser = StreamParser()
links = []
with open(sys.argv[1], "rb") as handle:
    while chunk := handle.read(4096):
        links.extend(parser.parse_chunk(chunk.decode("utf-8")))
links.extend(parser.finalize())

def fields(link):
    return {
        value.id: " ".join(inner.id for inner in (value.values or []))
        for value in (link.values or [])
    }

timeline = [fields(link) for link in links if link.id == "timeline"]
print(json.dumps({
    "links": len(links),
    "kinds": sorted({row["kind"] for row in timeline}),
    "sequences": [int(row["sequence"]) for row in timeline],
    "actors": sorted({row["actor"] for row in timeline}),
    "outcomes": sorted({row["outcome"] for row in timeline}),
    "checkpoints": [
        fields(link)["name"] for link in links if link.id == "checkpoint"
    ],
    "members": sorted({
        member
        for link in links if link.id == "checkpoint"
        for name, member in fields(link).items()
        if name in {"html", "state", "screenshot"}
    }),
    "controlDiffs": [
        {key: fields(link).get(key) for key in ("path", "before", "after", "actor")}
        for link in links if link.id == "control-diff"
    ],
    "result": next(
        (fields(link) for link in links if link.id == "result"), None
    ),
}, indent=2))
`;

/**
 * Run a reader written in another language and let it print its own view.
 *
 * @param {string} what - Name of the language, for the error message
 * @param {string} command - Program to run
 * @param {string[]} args - Arguments for the program
 * @returns {Promise<void>} Resolves when the reader has printed its view
 */
const readWith = (what, command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${what} exited ${code}`))
    );
  });

const server = await startTraceServer();
const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-trace-links-'));
const { page, cleanup } = await launchE2EBrowser({ engine });
const commander = makeBrowserCommander({ page });

try {
  await page.goto(`${server.baseUrl}/`);
  const trace = await commander.startTrace({
    output: path.join(artifacts, 'run'),
    mode: TRACE_MODE.CONTINUOUS,
    screenshots: true,
    links: { output: path.join(artifacts, 'run.lino') },
  });

  await page.type('#name', 'alice');
  await trace.checkpoint('the user typed a name');
  await page.click('#add');
  await page.click('#touch');
  await trace.checkpoint('the app updated itself');
  const stopped = await trace.stop();

  const exported = await fs.readFile(stopped.links, 'utf8');
  console.log(`JavaScript wrote ${stopped.links}:`);
  console.log(exported);

  console.log('Python reader:');
  await readWith('python3', 'python3', ['-c', PYTHON_READER, stopped.links]);
  console.log(
    `\nThe bundle is still the record: ${stopped.path}\n` +
      `The export duplicates none of its bytes: ` +
      `${exported.length} characters beside ${
        (await fs.readdir(path.join(stopped.path, 'checkpoints'))).length
      } checkpoint members it points at.`
  );
} finally {
  await commander.destroy();
  await cleanup();
  await server.close();
  await fs.rm(artifacts, { recursive: true, force: true });
}
