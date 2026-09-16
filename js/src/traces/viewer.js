/**
 * The offline trace viewer (issue #87).
 *
 * The viewer is one static HTML file written into the bundle. It opens from
 * the filesystem with no server, and it is inert by construction: captured
 * markup is rendered inside a sandboxed frame that inherits a
 * `default-src 'none'` policy, so the recorded page cannot run its scripts,
 * submit its forms, or reach the network from a reviewer's machine.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { TRACE_FILES } from './schema.js';
import { TRACE_FILE_MODE } from './bundle.js';
import { diffControlState, readTrace } from './reader.js';

/** How much captured HTML is embedded per checkpoint before it is elided. */
export const DEFAULT_MAX_INLINE_BYTES = 8 * 1024 * 1024;

/**
 * Escape a value so it can sit inside a `<script type="application/json">`.
 *
 * @param {*} data - JSON-compatible value
 * @returns {string} Safe JSON text
 */
function embed(data) {
  // `<` is escaped so the JSON can never close the script element, and the
  // two Unicode line separators are escaped because they are line breaks to a
  // JavaScript parser but not to `JSON.stringify`.
  const LINE_SEPARATORS = new RegExp('[\u2028\u2029]', 'g');
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(LINE_SEPARATORS, (match) =>
      match === '\u2028' ? '\\u2028' : '\\u2029'
    );
}

const VIEWER_STYLE = `
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; display: grid; grid-template-columns: 22rem 1fr;
         grid-template-rows: auto 1fr; height: 100vh; }
  header { grid-column: 1 / -1; padding: 0.5rem 1rem; border-bottom: 1px solid #8884; }
  h1 { font-size: 1rem; margin: 0 0 0.25rem; }
  .meta { font-size: 0.75rem; opacity: 0.75; }
  .meta.replay { opacity: 0.9; font-style: italic; }
  aside { overflow: auto; border-right: 1px solid #8884; }
  main { display: grid; grid-template-rows: auto 1fr auto; overflow: hidden; }
  ol { list-style: none; margin: 0; padding: 0; font-size: 0.8rem; }
  li { padding: 0.35rem 0.75rem; border-bottom: 1px solid #8882; cursor: pointer; }
  li.selected { background: #3b82f633; }
  li .kind { font-weight: 600; }
  li .at { opacity: 0.6; float: right; }
  iframe { width: 100%; height: 100%; border: 0; background: #fff; }
  .panel { padding: 0.5rem 1rem; border-top: 1px solid #8884; max-height: 14rem;
           overflow: auto; font-size: 0.8rem; }
  table { border-collapse: collapse; width: 100%; }
  td, th { text-align: left; padding: 0.15rem 0.5rem; border-bottom: 1px solid #8882;
           font-family: ui-monospace, monospace; font-size: 0.75rem; }
  .controls { padding: 0.5rem 1rem; display: flex; gap: 0.5rem; align-items: center; }
  .dropped { color: #b91c1c; }
  button { font: inherit; }
`;

const VIEWER_SCRIPT = String.raw`
const trace = JSON.parse(document.getElementById('trace-data').textContent);
const timeline = document.getElementById('timeline');
const frame = document.getElementById('stage');
const details = document.getElementById('details');
const diffPanel = document.getElementById('diff');
const stepLabel = document.getElementById('step');
let selectedCheckpoint = null;
let mutationStep = 0;

function checkpointFor(event) {
  if (event.kind === 'checkpoint') return event.index;
  let latest = null;
  for (const other of trace.events) {
    if (other.sequence > event.sequence) break;
    if (other.kind === 'checkpoint') latest = other.index;
  }
  return latest;
}

function renderHtml(index, html) {
  // The captured document is handed to a sandboxed frame with no
  // allow-scripts and no allow-forms: it is shown, never run.
  frame.srcdoc = html == null ? '<p style="font:1rem system-ui">no HTML captured for this checkpoint</p>' : html;
}

function nodeOf(parsed, described) {
  if (!described) return null;
  if (described.type === 'text') {
    return parsed.createTextNode(described.text == null ? '' : described.text);
  }
  if (described.type === 'element' && described.html) {
    const holder = parsed.createElement('template');
    holder.innerHTML = described.html;
    return holder.content.firstChild;
  }
  return null;
}

function looksLike(node, described) {
  if (!node || !described) return false;
  if (described.type === 'text') return node.nodeType === 3;
  if (described.type !== 'element') return false;
  if (node.nodeType !== 1 || node.localName !== described.tag) return false;
  return described.id ? node.id === described.id : true;
}

function childLike(parent, described) {
  if (!described) return null;
  // An id is identity; an index is only a hint. A node that moved is reported
  // at the position it moved *to*, so the index alone would find the wrong one.
  if (described.id) {
    for (const child of parent.childNodes) {
      if (child.nodeType === 1 && child.id === described.id) return child;
    }
  }
  const at = described.index == null ? null : parent.childNodes[described.index];
  if (looksLike(at, described)) return at;
  for (const child of parent.childNodes) {
    if (looksLike(child, described)) return child;
  }
  return null;
}

function insertAt(parent, node, index) {
  if (!node) return false;
  const reference = index == null ? null : parent.childNodes[index] || null;
  parent.insertBefore(node, reference);
  return true;
}

function applyLiveState(parsed, target, record) {
  const value = record.after;
  const text = value == null ? '' : String(value);
  if (record.property === 'scroll') {
    // A static copy of a document cannot be scrolled, so where it was
    // scrolled to is written onto the element rather than quietly lost.
    const element = target || parsed.documentElement;
    const at = value || {};
    element.setAttribute('data-bc-scroll', at.top + ',' + at.left);
    return true;
  }
  if (!target) return false;
  if (record.property === 'value') {
    // Serialized HTML carries attributes, not properties, so what was typed
    // is written where a re-parse will still find it.
    if (target.localName === 'textarea' || target.hasAttribute('contenteditable')) {
      target.textContent = text;
    } else {
      target.setAttribute('value', text);
    }
    return true;
  }
  if (record.property === 'checked') {
    if (value) target.setAttribute('checked', '');
    else target.removeAttribute('checked');
    return true;
  }
  if (record.property === 'selected') {
    const chosen = (Array.isArray(value) ? value : []).map(String);
    for (const option of target.querySelectorAll('option')) {
      if (chosen.indexOf(option.value) !== -1) option.setAttribute('selected', '');
      else option.removeAttribute('selected');
    }
    return true;
  }
  if (record.property === 'focus') {
    for (const had of parsed.querySelectorAll('[data-bc-focus]')) {
      had.removeAttribute('data-bc-focus');
    }
    if (value) target.setAttribute('data-bc-focus', '');
    return true;
  }
  return false;
}

function applyMutations(index, upTo) {
  const html = trace.html[index];
  if (html == null) return null;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const batches = trace.mutations[index] || [];
  let applied = 0;
  let skipped = 0;
  for (const batch of batches.slice(0, upTo)) {
    // The stage holds one document. A batch from an iframe belongs to a
    // different one, so it is counted rather than applied to the wrong page.
    if (batch.mainFrame === false) { skipped += (batch.records || []).length; continue; }
    for (const record of batch.records) {
      const target = record.target && record.target.path
        ? parsed.querySelector(record.target.path)
        : null;
      if (record.kind === 'live-state') {
        if (applyLiveState(parsed, target, record)) applied++; else skipped++;
      } else if (!target) {
        skipped++;
        continue;
      } else if (record.kind === 'attributes' && record.attribute) {
        if (record.after == null) target.removeAttribute(record.attribute);
        else target.setAttribute(record.attribute, record.after);
        applied++;
      } else if (record.kind === 'characterData') {
        target.textContent = record.after == null ? '' : record.after;
        applied++;
      } else if (record.kind === 'childList') {
        // Where a node went is as much of the change as what it was: appending
        // every addition to the end replays an insertion before a sibling in
        // the wrong place, and drops removals entirely (issue #93).
        for (const removed of record.removed || []) {
          const node = childLike(target, removed);
          if (node) { target.removeChild(node); applied++; } else { skipped++; }
        }
        const added = (record.added || []).filter(Boolean)
          .slice().sort((a, b) => (a.index == null ? 1e9 : a.index) - (b.index == null ? 1e9 : b.index));
        for (const entry of added) {
          if (insertAt(target, nodeOf(parsed, entry), entry.index)) applied++;
          else skipped++;
        }
      } else {
        skipped++;
      }
      if (target && target.style) target.style.outline = '2px solid #f59e0b';
    }
  }
  return { html: '<!DOCTYPE html>' + parsed.documentElement.outerHTML, applied, skipped };
}

function stepText(step, total, result) {
  const base = 'batch ' + step + ' of ' + total;
  if (!result || !result.skipped) return base;
  return base + ' · ' + result.skipped + ' not replayable here';
}

function showCheckpoint(index) {
  selectedCheckpoint = index;
  mutationStep = 0;
  renderHtml(index, trace.html[index]);
  const state = trace.state[index];
  const previous = trace.state[index - 1];
  details.innerHTML = state
    ? '<table><tr><th>url</th><td>' + state.url + '</td></tr>' +
      '<tr><th>title</th><td>' + (state.title || '') + '</td></tr>' +
      '<tr><th>controls</th><td>' + (state.controls || []).length + '</td></tr></table>'
    : '<p>no state captured</p>';
  const changes = trace.diffs[index] || [];
  diffPanel.innerHTML = previous && changes.length
    ? '<table><tr><th>control</th><th>before</th><th>after</th></tr>' +
      changes.map((c) => '<tr><td>' + c.path + '</td><td>' + (c.before ?? '') +
        '</td><td>' + (c.after ?? '') + '</td></tr>').join('') + '</table>'
    : '<p>no control changes against the previous checkpoint</p>';
  stepLabel.textContent = (trace.mutations[index] || []).length + ' mutation batches';
}

function select(event, element) {
  for (const li of timeline.children) li.classList.remove('selected');
  element.classList.add('selected');
  const index = checkpointFor(event);
  if (index != null && index !== selectedCheckpoint) showCheckpoint(index);
  if (event.kind !== 'checkpoint') {
    details.innerHTML = '<table>' + Object.entries(event)
      .map(([k, v]) => '<tr><th>' + k + '</th><td>' + String(
        typeof v === 'object' ? JSON.stringify(v) : v).slice(0, 400) + '</td></tr>')
      .join('') + '</table>';
  }
}

for (const event of trace.events) {
  const li = document.createElement('li');
  if (event.kind === 'dropped') li.className = 'dropped';
  li.innerHTML = '<span class="kind"></span> <span class="at"></span><div class="what"></div>';
  li.querySelector('.kind').textContent = event.kind;
  li.querySelector('.at').textContent = (event.at || '').slice(11, 23);
  li.querySelector('.what').textContent =
    event.name || event.action || event.text || event.message || event.url || event.reason || '';
  li.addEventListener('click', () => select(event, li));
  timeline.append(li);
}

document.getElementById('play').addEventListener('click', async () => {
  if (selectedCheckpoint == null) return;
  const batches = trace.mutations[selectedCheckpoint] || [];
  for (let step = 1; step <= batches.length; step++) {
    const result = applyMutations(selectedCheckpoint, step);
    if (result) frame.srcdoc = result.html;
    stepLabel.textContent = stepText(step, batches.length, result);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
});

document.getElementById('step-forward').addEventListener('click', () => {
  if (selectedCheckpoint == null) return;
  const batches = trace.mutations[selectedCheckpoint] || [];
  mutationStep = Math.min(mutationStep + 1, batches.length);
  const result = applyMutations(selectedCheckpoint, mutationStep);
  if (result) frame.srcdoc = result.html;
  stepLabel.textContent = stepText(mutationStep, batches.length, result);
});

document.getElementById('reset').addEventListener('click', () => {
  if (selectedCheckpoint != null) showCheckpoint(selectedCheckpoint);
});

if (trace.checkpoints.length) showCheckpoint(trace.checkpoints[0].index);
`;

/**
 * What this bundle can be replayed from, in the viewer's own words.
 *
 * Issue #93 asked for the viewer to say plainly that it reconstructs a run
 * rather than replaying a recording of one, and to stop implying it can show
 * things the bundle does not contain. A checkpoints-only trace has nothing
 * between its checkpoints; a continuous one has as much as it recorded.
 *
 * @param {Object} manifest - The bundle's manifest
 * @returns {string} A one-line description of what replay covers
 */
export function replaySummary(manifest) {
  const replay = manifest?.replay ?? {};
  const covered = [];
  if (replay.mutations) {
    covered.push('DOM mutations');
  }
  if (replay.childListPositions) {
    covered.push('insertion positions and removals');
  }
  if (replay.liveState) {
    covered.push('live control state');
  }
  if (replay.identifiers) {
    covered.push('page and frame identities');
  }
  return covered.length === 0
    ? 'partial diagnostic replay: checkpoints only, nothing between them'
    : `partial diagnostic replay: checkpoints, ${covered.join(', ')}`;
}

/**
 * Collect everything the viewer embeds.
 *
 * @param {Object} reader - An open trace, from `readTrace()`
 * @param {number} maxInlineBytes - Ceiling per embedded member
 * @returns {Promise<Object>} The viewer's data
 */
async function collectViewerData(reader, maxInlineBytes) {
  const html = {};
  const state = {};
  const mutations = {};
  const diffs = {};
  const elided = [];

  for (const checkpoint of reader.checkpoints) {
    const body = await reader.html(checkpoint.index);
    if (body !== null && body.length > maxInlineBytes) {
      elided.push(checkpoint.index);
      html[checkpoint.index] = null;
    } else {
      html[checkpoint.index] = body;
    }
    state[checkpoint.index] = await reader.state(checkpoint.index);
    mutations[checkpoint.index] = await reader.mutations(checkpoint.index);
  }

  for (const checkpoint of reader.checkpoints) {
    const previous = state[checkpoint.index - 1];
    diffs[checkpoint.index] = previous
      ? diffControlState(previous, state[checkpoint.index])
      : [];
  }

  return {
    manifest: reader.manifest,
    events: reader.events,
    checkpoints: reader.checkpoints,
    html,
    state,
    mutations,
    diffs,
    elided,
  };
}

/**
 * Render the viewer for an open trace.
 *
 * @param {Object} reader - An open trace, from `readTrace()`
 * @param {Object} [options] - `{maxInlineBytes}`
 * @returns {Promise<string>} The viewer document
 */
export async function renderTraceViewer(reader, options = {}) {
  const { maxInlineBytes = DEFAULT_MAX_INLINE_BYTES } = options;
  const data = await collectViewerData(reader, maxInlineBytes);
  const manifest = reader.manifest;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<!-- Inert by default: no network, no captured scripts, images only from data URLs. -->
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-src 'self' data:;">
<title>Browser Commander trace</title>
<style>${VIEWER_STYLE}</style>
</head>
<body>
<header>
  <h1>Browser Commander trace</h1>
  <div class="meta">
    mode ${manifest.mode} · outcome ${manifest.outcome} · engine ${manifest.engine ?? 'unknown'} ·
    ${manifest.counts?.checkpoints ?? 0} checkpoints · ${manifest.counts?.events ?? 0} events ·
    ${manifest.dropped ?? 0} dropped · started ${manifest.startedAt ?? 'unknown'}
  </div>
  <div class="meta replay">${replaySummary(manifest)}</div>
</header>
<aside><ol id="timeline"></ol></aside>
<main>
  <div class="controls">
    <button id="play" type="button">Replay mutations</button>
    <button id="step-forward" type="button">Step</button>
    <button id="reset" type="button">Reset</button>
    <span id="step"></span>
  </div>
  <iframe id="stage" sandbox referrerpolicy="no-referrer" title="captured page"></iframe>
  <div class="panel" id="details"></div>
  <div class="panel" id="diff"></div>
</main>
<script id="trace-data" type="application/json">${embed(data)}</script>
<script>${VIEWER_SCRIPT}</script>
</body>
</html>
`;
}

/**
 * Write the viewer into a bundle.
 *
 * @param {string} bundlePath - Path to the bundle directory
 * @param {Object} [options] - `{maxInlineBytes}`
 * @returns {Promise<string>} Path to the written viewer
 */
export async function writeTraceViewer(bundlePath, options = {}) {
  const reader = await readTrace(bundlePath);
  const document = await renderTraceViewer(reader, options);
  const target = path.join(reader.path, TRACE_FILES.VIEWER);
  await fs.writeFile(target, document, { mode: TRACE_FILE_MODE });
  return target;
}
