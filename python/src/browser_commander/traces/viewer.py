"""The offline trace viewer (issue #108).

A port of ``js/src/traces/viewer.js``. The viewer is one static HTML file
written into the bundle. It opens from the filesystem with no server, and it is
inert by construction: captured markup is rendered inside a sandboxed frame
that inherits a ``default-src 'none'`` policy, so the recorded page cannot run
its scripts, submit its forms, or reach the network from a reviewer's machine.

The style and script are the JavaScript viewer's own, read from
``assets.json``, so a viewer written by Python is byte-for-byte the viewer
JavaScript writes for the same bundle.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .bundle import write_private_file
from .engine import load_assets
from .jsonfmt import UNDEFINED, coalesce, dumps, js_string, js_truthy, utf16_length
from .links import checkpoint_events, js_diff_control_state
from .reader import Trace, read_trace
from .schema import TraceFiles, sequence_name

#: How much captured HTML is embedded per checkpoint before it is elided.
DEFAULT_MAX_INLINE_BYTES = 8 * 1024 * 1024


def _embed(data: Any) -> str:
    """Escape a value so it can sit inside ``<script type="application/json">``."""
    # `<` is escaped so the JSON can never close the script element, and the
    # two Unicode line separators because they are line breaks to a
    # JavaScript parser but not to JSON.
    return (
        dumps(data)
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def replay_summary(manifest: Any) -> str:
    """What this bundle can be replayed from, in the viewer's own words.

    Args:
        manifest: The bundle's manifest

    Returns:
        A one-line description of what replay covers
    """
    replay = coalesce(
        manifest.get("replay") if isinstance(manifest, dict) else None, {}
    )
    covered = []
    if js_truthy(replay.get("mutations")):
        covered.append("DOM mutations")
    if js_truthy(replay.get("childListPositions")):
        covered.append("insertion positions and removals")
    if js_truthy(replay.get("liveState")):
        covered.append("live control state")
    if js_truthy(replay.get("identifiers")):
        covered.append("page and frame identities")
    if not covered:
        return "partial diagnostic replay: checkpoints only, nothing between them"
    return f"partial diagnostic replay: checkpoints, {', '.join(covered)}"


def _read_html(reader: Trace, index: int) -> str | None:
    # The reader reads text with universal newlines; the viewer embeds the
    # markup exactly as it was captured, carriage returns included.
    member = Path(
        reader.path, TraceFiles.CHECKPOINTS_DIR, f"{sequence_name(index)}.html"
    )
    try:
        with member.open(encoding="utf-8", errors="replace", newline="") as handle:
            return handle.read()
    except FileNotFoundError:
        return None


def _previous_index(index: Any) -> Any:
    if isinstance(index, bool) or not isinstance(index, (int, float)):
        return UNDEFINED
    return index - 1


def _collect_viewer_data(reader: Trace, max_inline_bytes: int) -> dict[str, Any]:
    html: dict[Any, Any] = {}
    state: dict[Any, Any] = {}
    mutations: dict[Any, Any] = {}
    diffs: dict[Any, Any] = {}
    elided: list[Any] = []
    checkpoints = checkpoint_events(reader)

    for checkpoint in checkpoints:
        index = checkpoint["index"]
        body = _read_html(reader, index)
        if body is not None and utf16_length(body) > max_inline_bytes:
            elided.append(index)
            html[index] = None
        else:
            html[index] = body
        state[index] = reader.state(index)
        mutations[index] = reader.mutations(index)

    for checkpoint in checkpoints:
        index = checkpoint["index"]
        previous = state.get(_previous_index(index), UNDEFINED)
        diffs[index] = (
            js_diff_control_state(previous, state[index]) if js_truthy(previous) else []
        )

    return {
        "manifest": reader.manifest,
        "events": reader.events,
        "checkpoints": checkpoints,
        "html": html,
        "state": state,
        "mutations": mutations,
        "diffs": diffs,
        "elided": elided,
    }


def render_trace_viewer(
    reader: Trace, max_inline_bytes: int = DEFAULT_MAX_INLINE_BYTES
) -> str:
    """Render the viewer for an open trace.

    Args:
        reader: An open trace, from :func:`read_trace`
        max_inline_bytes: Ceiling per embedded checkpoint's HTML

    Returns:
        The viewer document
    """
    data = _collect_viewer_data(reader, max_inline_bytes)
    manifest = reader.manifest
    counts = coalesce(manifest.get("counts"), {})
    viewer = load_assets()["viewer"]

    def text(value: Any, fallback: Any) -> str:
        return js_string(coalesce(value, fallback))

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<!-- Inert by default: no network, no captured scripts, images only from data URLs. -->
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-src 'self' data:;">
<title>Browser Commander trace</title>
<style>{viewer["style"]}</style>
</head>
<body>
<header>
  <h1>Browser Commander trace</h1>
  <div class="meta">
    mode {js_string(manifest.get("mode", UNDEFINED))} · outcome {js_string(manifest.get("outcome", UNDEFINED))} · engine {text(manifest.get("engine"), "unknown")} ·
    {text(counts.get("checkpoints"), 0)} checkpoints · {text(counts.get("events"), 0)} events ·
    {text(manifest.get("dropped"), 0)} dropped · started {text(manifest.get("startedAt"), "unknown")}
  </div>
  <div class="meta replay">{replay_summary(manifest)}</div>
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
<script id="trace-data" type="application/json">{_embed(data)}</script>
<script>{viewer["script"]}</script>
</body>
</html>
"""


def write_trace_viewer(
    bundle_path: str | os.PathLike[str],
    max_inline_bytes: int = DEFAULT_MAX_INLINE_BYTES,
) -> str:
    """Write the viewer into a bundle.

    Args:
        bundle_path: Path to the bundle directory
        max_inline_bytes: Ceiling per embedded checkpoint's HTML

    Returns:
        Path to the written viewer
    """
    reader = read_trace(bundle_path)
    document = render_trace_viewer(reader, max_inline_bytes=max_inline_bytes)
    target = Path(reader.path, TraceFiles.VIEWER)
    write_private_file(target, document.encode("utf-8", "surrogatepass"))
    return str(target)
