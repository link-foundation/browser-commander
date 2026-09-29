#!/usr/bin/env bash
# Which Local State keys stop Microsoft Edge from opening edge://welcome-edge/
# in a brand-new user data directory? Prints the page targets after startup.
#
#   xvfb-run -a bash experiments/issue-103/edge-first-run.sh [/usr/bin/microsoft-edge]
#
# Measured with Edge 153: only fre.has_user_seen_fre in Local State does it;
# the same keys in Default/Preferences and fre.has_user_completed_fre do not.
EDGE=${1:-/usr/bin/microsoft-edge}
try() {
  D=$(mktemp -d); touch "$D/First Run"; echo "$1" > "$D/Local State"
  if [ -n "$2" ]; then mkdir -p "$D/Default"; echo "$2" > "$D/Default/Preferences"; fi
  "$EDGE" --user-data-dir="$D" --remote-debugging-port=45673 about:blank > /dev/null 2>&1 &
  sleep 6
  echo "Local State=$1 Preferences=$2"
  curl -s http://127.0.0.1:45673/json/list | python3 -c 'import json,sys; print("   ", [t["url"][:40] for t in json.load(sys.stdin) if t["type"]=="page"])'
  pkill -9 -f "user-data-dir=$D"; sleep 1; rm -rf "$D"
}
try '{"browser":{"last_whats_new_version":9999}}'
try '{"browser":{"last_whats_new_version":9999},"fre":{"has_first_visible_browser_session_completed":true}}'
try '{"browser":{"last_whats_new_version":9999},"fre":{"has_user_completed_fre":true}}'
try '{"browser":{"last_whats_new_version":9999},"fre":{"has_user_seen_fre":true}}'
try '{"browser":{"last_whats_new_version":9999}}' '{"fre":{"has_user_seen_fre":true,"has_user_completed_fre":true}}'
