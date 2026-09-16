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

function applyMutations(index, upTo) {
  const html = trace.html[index];
  if (html == null) return null;
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const batches = trace.mutations[index] || [];
  let applied = 0;
  for (const batch of batches.slice(0, upTo)) {
    for (const record of batch.records) {
      const target = record.target && record.target.path
        ? parsed.querySelector(record.target.path)
        : null;
      if (!target) continue;
      if (record.kind === 'attributes' && record.attribute) {
        if (record.after == null) target.removeAttribute(record.attribute);
        else target.setAttribute(record.attribute, record.after);
        applied++;
      } else if (record.kind === 'characterData') {
        target.textContent = record.after == null ? '' : record.after;
        applied++;
      } else if (record.kind === 'childList') {
        for (const added of record.added || []) {
          if (added && added.type === 'element' && added.html) {
            target.insertAdjacentHTML('beforeend', added.html);
            applied++;
          }
        }
      }
      if (target.style) target.style.outline = '2px solid #f59e0b';
    }
  }
  return { html: '<!DOCTYPE html>' + parsed.documentElement.outerHTML, applied };
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
    stepLabel.textContent = 'batch ' + step + ' of ' + batches.length;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
});

document.getElementById('step-forward').addEventListener('click', () => {
  if (selectedCheckpoint == null) return;
  const batches = trace.mutations[selectedCheckpoint] || [];
  mutationStep = Math.min(mutationStep + 1, batches.length);
  const result = applyMutations(selectedCheckpoint, mutationStep);
  if (result) frame.srcdoc = result.html;
  stepLabel.textContent = 'batch ' + mutationStep + ' of ' + batches.length;
});

document.getElementById('reset').addEventListener('click', () => {
  if (selectedCheckpoint != null) showCheckpoint(selectedCheckpoint);
});

if (trace.checkpoints.length) showCheckpoint(trace.checkpoints[0].index);
`;

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
