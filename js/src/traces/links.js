/**
 * A Links Notation view of a trace bundle (issue #94).
 *
 * The JSON bundle stays authoritative: this is an adapter over what the
 * readers already produce, not a second recorder. Nothing here can change what
 * a trace says, which is the point - a portable export that could disagree
 * with the bundle would be worse than no export at all.
 *
 * The export is line oriented. One link per line means `grep`, `diff` and
 * `head` work on a trace the way they work on a log, and a run that was killed
 * still leaves every line it had finished writing.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { formatLinks, Link } from 'links-notation';
import { diffControlState, readTrace } from './reader.js';
import { TRACE_EVENT } from './schema.js';

/**
 * Version of this representation.
 *
 * The bundle's own `schemaVersion` says what was recorded; this says how it is
 * written as links. They move independently: adding a field to an event does
 * not change the shape of the export, and changing the shape of the export
 * does not mean anything new was recorded.
 */
export const TRACE_LINKS_VERSION = 1;

/** Extension used when an output path names a directory or has none. */
export const TRACE_LINKS_FILE = 'trace.lino';

/** Sections a caller can include, in the order they are written. */
export const TRACE_LINKS_SECTIONS = Object.freeze([
  /** The header and the closing result link. */
  'trace',
  /** One link per ordered timeline event. */
  'timeline',
  /** One link per checkpoint, referencing its members by path. */
  'checkpoints',
  /** One link per control whose value changed between two checkpoints. */
  'control-diffs',
]);

/** Ids of the links this module writes. */
export const TRACE_LINK_IDS = Object.freeze({
  TRACE: 'trace',
  TIMELINE: 'timeline',
  CHECKPOINT: 'checkpoint',
  CONTROL_DIFF: 'control-diff',
  RESULT: 'result',
});

/** What an event's `outcome` field can say. */
export const TRACE_LINK_OUTCOME = Object.freeze({
  /** Nothing went wrong and nothing is missing. */
  RECORDED: 'recorded',
  /** The action this event reports succeeded. */
  OK: 'ok',
  /** The action this event reports failed. */
  FAILED: 'failed',
  /** The record is here but incomplete, such as truncated markup. */
  PARTIAL: 'partial',
  /** Something could not be recorded at all. */
  DROPPED: 'dropped',
});

/**
 * Who caused an event, when the event does not say so itself.
 *
 * Most records carry no actor because, in the bundle, the kind implies it. An
 * export that leaves the field out would make a reader guess, so the implied
 * answer is written down.
 */
const IMPLIED_ACTOR = Object.freeze({
  [TRACE_EVENT.TRACE_START]: 'recorder',
  [TRACE_EVENT.TRACE_STOP]: 'recorder',
  [TRACE_EVENT.MUTATIONS]: 'recorder',
  [TRACE_EVENT.DROPPED]: 'recorder',
  [TRACE_EVENT.INTERACTION]: 'automation',
  [TRACE_EVENT.CHECKPOINT]: 'automation',
  [TRACE_EVENT.NAVIGATION]: 'browser',
  [TRACE_EVENT.CONSOLE]: 'browser',
  [TRACE_EVENT.PAGE_ERROR]: 'browser',
  [TRACE_EVENT.DIALOG]: 'browser',
  [TRACE_EVENT.REQUEST_FAILED]: 'browser',
  [TRACE_EVENT.DOWNLOAD]: 'browser',
});

/** Fields the head of a timeline link already accounts for. */
const HEAD_FIELDS = new Set([
  'sequence',
  'at',
  'monotonicMs',
  'kind',
  'traceId',
  'browserContextId',
  'pageId',
  'navigationId',
  'frameId',
  'action',
  'actor',
  'target',
  'outcome',
]);

/**
 * Make one value safe to write as a link.
 *
 * Links Notation 0.20 quotes a value with whichever quote character the value
 * does not contain, and its parser does not read escapes, so a value holding
 * both quote characters cannot be read back. Newlines are worse: they would
 * split one record across lines. Both are encoded here, reversibly, rather
 * than dropped, so the export loses nothing the bundle holds.
 *
 * @param {*} value - Any scalar from a trace record
 * @returns {string} Text that survives a format and parse round trip
 */
export function encodeLinkText(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const escaped = text
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');
  // Only a value that holds both quote characters is unquotable, so only that
  // value pays for the ugliness of an escaped quote.
  return escaped.includes("'") && escaped.includes('"')
    ? escaped.replaceAll('"', '\\u0022')
    : escaped;
}

/**
 * Read back what `encodeLinkText` wrote.
 *
 * @param {string} text - A value parsed out of an exported link
 * @returns {string} The original text
 */
export function decodeLinkText(text) {
  const decoded = { '\\': '\\', n: '\n', r: '\r', t: '\t', u0022: '"' };
  return String(text).replace(
    /\\(\\|n|r|t|u0022)/g,
    (match, code) => decoded[code]
  );
}

const leaf = (value) => new Link(encodeLinkText(value));

/**
 * One `(name: value)` pair, or nothing when there is no value to write.
 *
 * @param {string} name - Field name
 * @param {*} value - Field value; `null` and `undefined` are left out
 * @returns {Link|null} The pair
 */
function field(name, value) {
  if (value === null || value === undefined) {
    return null;
  }
  return new Link(name, [leaf(value)]);
}

/**
 * What an event's outcome was, in the export's own words.
 *
 * @param {Object} event - A timeline event
 * @returns {string} One of TRACE_LINK_OUTCOME
 */
function outcomeOf(event) {
  if (event.kind === TRACE_EVENT.DROPPED) {
    return TRACE_LINK_OUTCOME.DROPPED;
  }
  if (event.ok === false || event.error || event.failure) {
    return TRACE_LINK_OUTCOME.FAILED;
  }
  if (event.truncated === true) {
    return TRACE_LINK_OUTCOME.PARTIAL;
  }
  if (event.ok === true) {
    return TRACE_LINK_OUTCOME.OK;
  }
  return TRACE_LINK_OUTCOME.RECORDED;
}

/**
 * What an event happened to, when it happened to something addressable.
 *
 * @param {Object} event - A timeline event
 * @returns {string|null} A selector, a URL or a bundle member
 */
function targetOf(event) {
  return event.target ?? event.url ?? event.member ?? null;
}

/**
 * Turn one timeline event into one link.
 *
 * @param {Object} event - An event as written to `events.ndjson`
 * @returns {Link} The `(timeline: ...)` link
 */
export function timelineLink(event) {
  const values = [
    field('sequence', event.sequence),
    field('at', event.at),
    field('monotonicMs', event.monotonicMs),
    field('kind', event.kind),
    field('trace', event.traceId),
    field('context', event.browserContextId),
    field('page', event.pageId),
    field('navigation', event.navigationId),
    field('frame', event.frameId),
    field('actor', event.actor ?? IMPLIED_ACTOR[event.kind] ?? null),
    field('action', event.action ?? event.phase ?? null),
    field('target', targetOf(event)),
    field('outcome', outcomeOf(event)),
  ];

  // Whatever else the event carried is kept under its own name. A kind this
  // module has never heard of still exports everything it holds, which is what
  // keeps the adapter from quietly becoming the reason a trace lost a field.
  for (const [name, value] of Object.entries(event)) {
    if (HEAD_FIELDS.has(name) || value === null || value === undefined) {
      continue;
    }
    if (name === 'members') {
      // The checkpoint link says where the members are; saying it twice would
      // make one of the two the wrong place to fix.
      continue;
    }
    values.push(field(name, value));
  }

  return new Link(TRACE_LINK_IDS.TIMELINE, values.filter(Boolean));
}

/**
 * Turn one checkpoint into one link that points at its members.
 *
 * Members are named by their path inside the bundle. A screenshot is a file
 * next to this one, so the export stays a text file of any size a text file
 * should be, and there is exactly one copy of every byte.
 *
 * The interval of mutations that starts here is named by its own timeline
 * link, which carries the checkpoint index it belongs to. It is not repeated
 * here, because a checkpoint cannot know its own interval until the next
 * checkpoint drains it, and an export written as the run happens has to say
 * the same thing as an export of the finished bundle.
 *
 * @param {Object} event - The checkpoint event from the timeline
 * @returns {Link} The `(checkpoint: ...)` link
 */
export function checkpointLink(event) {
  const members = event.members ?? {};
  return new Link(
    TRACE_LINK_IDS.CHECKPOINT,
    [
      field('index', event.index),
      field('sequence', event.sequence),
      field('at', event.at),
      field('name', event.name),
      field('actor', event.actor),
      field('reason', event.reason),
      field('page', event.pageId),
      field('navigation', event.navigationId),
      field('url', event.url),
      field('outcome', outcomeOf(event)),
      field('html', members.html),
      field('state', members.state),
      field('screenshot', members.screenshot),
    ].filter(Boolean)
  );
}

/**
 * Turn one control change into one link.
 *
 * @param {Object} change - A record from `diffControlState`
 * @param {Object} context - `{checkpoint, previous, actor}`
 * @returns {Link} The `(control-diff: ...)` link
 */
export function controlDiffLink(change, context) {
  return new Link(
    TRACE_LINK_IDS.CONTROL_DIFF,
    [
      field('checkpoint', context.checkpoint),
      field('previous', context.previous),
      field('path', change.path),
      field('change', change.change),
      field('before', change.before),
      field('after', change.after),
      field('actor', context.actor),
    ].filter(Boolean)
  );
}

/**
 * The link that opens an export.
 *
 * @param {Object} about - `{bundle, schemaVersion, mode, engine, startedAt, commanderVersion}`
 * @returns {Link} The `(trace: ...)` link
 */
export function traceHeaderLink(about) {
  return new Link(
    TRACE_LINK_IDS.TRACE,
    [
      field('format', 'browser-commander-trace'),
      field('links', TRACE_LINKS_VERSION),
      field('schema', about.schemaVersion),
      field('bundle', about.bundle),
      field('mode', about.mode),
      field('engine', about.engine),
      field('started', about.startedAt),
      field('commander', about.commanderVersion),
    ].filter(Boolean)
  );
}

/**
 * The link that closes an export.
 *
 * A reader that does not find this link is reading a run that never stopped,
 * which is exactly what it should conclude.
 *
 * @param {Object} manifest - The bundle's manifest
 * @param {Object} [options] - `{truncated}` as the reader judged it
 * @returns {Link} The `(result: ...)` link
 */
export function traceResultLink(manifest, { truncated = false } = {}) {
  const counts = manifest?.counts ?? {};
  const replay = Object.entries(manifest?.replay ?? {})
    .filter(([, supported]) => supported)
    .map(([name]) => leaf(name));

  return new Link(
    TRACE_LINK_IDS.RESULT,
    [
      field('outcome', manifest?.outcome),
      field('stopped', manifest?.stoppedAt),
      field('events', counts.events),
      field('checkpoints', counts.checkpoints),
      field('mutationBatches', counts.mutationBatches),
      field('dropped', manifest?.dropped),
      field('truncated', truncated),
      replay.length ? new Link('replay', replay) : null,
    ].filter(Boolean)
  );
}

/**
 * Format links as the lines of an export.
 *
 * @param {Link[]} links - Links to write, in order
 * @returns {string} One link per line, newline terminated
 */
export function formatTraceLinks(links) {
  // Formatting one link at a time is what guarantees the line-per-record
  // layout, and is the same call the streaming sink makes for each record.
  return links.map((link) => `${formatLinks([link])}\n`).join('');
}

function chosenSections(include) {
  if (include === undefined) {
    return new Set(TRACE_LINKS_SECTIONS);
  }
  if (!Array.isArray(include)) {
    throw new Error('trace links include must be an array of section names');
  }
  for (const name of include) {
    if (!TRACE_LINKS_SECTIONS.includes(name)) {
      throw new Error(
        `unknown trace links section "${name}"; expected one of ${TRACE_LINKS_SECTIONS.join(', ')}`
      );
    }
  }
  return new Set(include);
}

/**
 * The links one event contributes to an export.
 *
 * Streaming and exporting a finished bundle both go through here, because two
 * routes to one representation that could drift apart would make neither
 * trustworthy.
 *
 * @param {Object} event - An event as written to the bundle
 * @param {Set<string>} sections - Sections the caller asked for
 * @returns {Link[]} The links for this event, in the order they are written
 */
function linksForEvent(event, sections) {
  const links = [];
  if (sections.has('timeline')) {
    links.push(timelineLink(event));
  }
  if (event.kind === TRACE_EVENT.CHECKPOINT && sections.has('checkpoints')) {
    links.push(checkpointLink(event));
  }
  return links;
}

/**
 * Build the links of a whole trace, in the order they are written.
 *
 * @param {Object|string} trace - An open trace, or a path to a bundle
 * @param {Object} [options] - `{include}`
 * @returns {Promise<Link[]>} Every link of the export
 */
export async function traceLinks(trace, options = {}) {
  const opened = typeof trace === 'string' ? await readTrace(trace) : trace;
  const sections = chosenSections(options.include);
  const links = [];

  if (sections.has('trace')) {
    links.push(
      traceHeaderLink({
        bundle: path.basename(opened.path),
        schemaVersion: opened.manifest?.schemaVersion,
        mode: opened.manifest?.mode,
        engine: opened.manifest?.engine,
        startedAt: opened.manifest?.startedAt,
        commanderVersion: opened.manifest?.commanderVersion,
      })
    );
  }

  for (const event of opened.events) {
    links.push(...linksForEvent(event, sections));
  }

  if (sections.has('control-diffs')) {
    links.push(...(await controlDiffLinks(opened)));
  }

  if (sections.has('trace')) {
    links.push(
      traceResultLink(opened.manifest, { truncated: opened.truncated })
    );
  }

  return links;
}

/**
 * Every control change between consecutive checkpoints of a trace.
 *
 * @param {Object} opened - An open trace
 * @returns {Promise<Link[]>} The `(control-diff: ...)` links
 */
async function controlDiffLinks(opened) {
  const links = [];
  let previous = null;

  for (const checkpoint of opened.checkpoints) {
    const state = await opened.state(checkpoint.index);
    if (previous && state) {
      for (const change of diffControlState(previous.state, state)) {
        links.push(
          controlDiffLink(change, {
            checkpoint: checkpoint.index,
            previous: previous.index,
            actor: checkpoint.actor,
          })
        );
      }
    }
    if (state) {
      previous = { index: checkpoint.index, state };
    }
  }

  return links;
}

/**
 * Resolve where an export should be written.
 *
 * @param {string} output - A file path, or a directory to write inside
 * @returns {Promise<string>} The file to write
 */
async function resolveOutput(output) {
  if (typeof output !== 'string' || output === '') {
    throw new Error('trace links output must be a path');
  }
  const resolved = path.resolve(output);
  try {
    const stats = await fs.stat(resolved);
    if (stats.isDirectory()) {
      return path.join(resolved, TRACE_LINKS_FILE);
    }
  } catch {
    // Nothing there yet, which is the ordinary case.
  }
  return resolved;
}

/**
 * Write a trace as Links Notation.
 *
 * @param {Object|string} trace - An open trace, or a path to a bundle
 * @param {string} output - Where to write
 * @param {Object} [options] - `{include}`
 * @returns {Promise<string>} The file that was written
 */
export async function writeTraceLinks(trace, output, options = {}) {
  const file = await resolveOutput(output);
  const links = await traceLinks(trace, options);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, formatTraceLinks(links), { mode: 0o600 });
  return file;
}

/**
 * Open a sink that writes links as a run happens.
 *
 * The sink exists so a trace that is killed still leaves a readable export:
 * every record that reached the bundle reached this file too. Control diffs
 * are the one thing it cannot stream, because a diff is the distance between
 * two checkpoints and the second one has not happened yet; they are appended
 * when the trace stops, from the bundle itself.
 *
 * @param {Object} options - `{output, include, bundle, schemaVersion, mode, engine, startedAt, commanderVersion}`
 * @returns {Promise<Object>} The sink
 */
export async function openTraceLinks(options = {}) {
  const { output, include, bundlePath, ...about } = options;
  const file = await resolveOutput(output);
  const sections = chosenSections(include);
  const problems = [];

  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, 'w', 0o600);

  // Writes are serialized against each other for the same reason the bundle's
  // are: a timeline whose lines arrive out of order is not a timeline.
  let queue = Promise.resolve();
  let closed = false;

  const append = (links) => {
    if (closed || links.length === 0) {
      return queue;
    }
    const pending = queue.then(() =>
      handle.write(formatTraceLinks(links)).catch((error) => {
        // A failed export must not take the run down with it; the bundle is
        // the authoritative record and it is still being written.
        problems.push({ member: file, detail: error.message });
      })
    );
    queue = pending.then(
      () => {},
      () => {}
    );
    return pending;
  };

  if (sections.has('trace')) {
    await append([
      traceHeaderLink({ ...about, bundle: path.basename(bundlePath ?? '') }),
    ]);
  }

  return {
    path: file,
    problems,
    /**
     * Write the links of one event as it is recorded.
     *
     * @param {Object} event - The event as written to the bundle
     * @returns {Promise<void>}
     */
    async event(event) {
      if (!event) {
        return;
      }
      await append(linksForEvent(event, sections));
    },
    /**
     * Finish the export.
     *
     * @param {Object} [closing] - `{manifest, bundlePath}`
     * @returns {Promise<string>} The file that was written
     */
    async close(closing = {}) {
      if (closed) {
        return file;
      }
      const links = [];
      if (sections.has('control-diffs') && closing.bundlePath) {
        try {
          links.push(
            ...(await controlDiffLinks(await readTrace(closing.bundlePath)))
          );
        } catch (error) {
          problems.push({ member: file, detail: error.message });
        }
      }
      if (sections.has('trace')) {
        links.push(
          traceResultLink(closing.manifest, {
            truncated: closing.manifest?.outcome !== 'complete',
          })
        );
      }
      await append(links);
      await queue;
      closed = true;
      await handle.close();
      return file;
    },
    /**
     * Remove the export, for a run whose bundle was discarded.
     *
     * @returns {Promise<void>}
     */
    async discard() {
      if (!closed) {
        await queue;
        closed = true;
        await handle.close();
      }
      await fs.rm(file, { force: true });
    },
  };
}
