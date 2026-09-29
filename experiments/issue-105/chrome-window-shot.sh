#!/usr/bin/env bash
# Start Xvfb with a framebuffer dump, run a Node script that launches Chrome,
# and convert the framebuffer to PNG while the browser is still open.
# Usage: chrome-window-shot.sh <out.png> <node-script> [args...]
# The node script must print "READY" on stdout when the window is ready to
# be captured, then wait for stdin to close.
set -euo pipefail
out="$1"; shift
fbdir="$(mktemp -d)"
display=":$((RANDOM % 400 + 100))"
Xvfb "$display" -screen 0 1280x800x24 -fbdir "$fbdir" >/dev/null 2>&1 &
xvfb_pid=$!
sleep 1
here="$(cd "$(dirname "$0")" && pwd)"
coproc NODE { DISPLAY="$display" node "$@"; }
node_pid=$NODE_PID
while read -r line <&"${NODE[0]}"; do
  echo "$line"
  if [[ "$line" == READY* ]]; then
    sleep "${SETTLE:-3}"
    node "$here/xwd-to-png.mjs" "$fbdir/Xvfb_screen0" "$out"
    break
  fi
done
exec {NODE[1]}>&-
cat <&"${NODE[0]}" || true
wait "$node_pid" || true
kill "$xvfb_pid" || true
rm -rf "$fbdir"
