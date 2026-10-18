"""Find the pref that keeps Chrome 155's session restore infobar closed.

Chrome 155 shows "Continue where you left off: Chrome can restore your tabs
every time you restart" in a fresh profile. Its show count is the profile pref
browser.session_restore_infobar_times_shown (string found in the Chrome 155
binary). This launches Chrome under Xvfb once per variant, with the profile
prepared by configure_user_data_dir plus the variant, and counts the ink in
the infobar band the same way experiments/issue-110/capture-infobar.py does.

Run with:
  PYTHONPATH=python/src xvfb-run -a -s '-screen 0 1360x900x24' \
      python experiments/session-restore-infobar/probe.py
Requires `pip install mss pillow`.
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import mss
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PROFILE_MODULE = (
    ROOT / "python" / "src" / "browser_commander" / "browser" / "profile_directory.py"
)
spec = importlib.util.spec_from_file_location("probe_profile_directory", PROFILE_MODULE)
assert spec is not None and spec.loader is not None
profile_directory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile_directory)

KEY = "session_restore_infobar_times_shown"
VARIANTS = {
    "none": ({}, {}),
    "prefs=1": ({"browser": {KEY: 1}}, {}),
    "prefs=2": ({"browser": {KEY: 2}}, {}),
    "prefs=3": ({"browser": {KEY: 3}}, {}),
    "prefs=5": ({"browser": {KEY: 5}}, {}),
    "local_state=5": ({}, {"browser": {KEY: 5}}),
    # The default-browser prompt with the session restore infobar closed.
    "prefs=5+check": (
        {"browser": {KEY: 5, "check_default_browser": True}},
        {
            "browser": {
                "default_browser_infobar_declined_count": 0,
                "default_browser_declined_count": 0,
            }
        },
    ),
}


def bar_ink(path: Path) -> int:
    with Image.open(path) as image:
        image = image.convert("RGB")
        return sum(
            min(pixel) < 220 or max(pixel) - min(pixel) > 10
            for y in range(108, 142)
            for x in range(50, 1030)
            for pixel in (image.getpixel((x, y)),)
        )


def run(name: str, preferences: dict, local_state: dict, out: Path) -> int:
    binary = shutil.which(os.environ.get("CHROME", "google-chrome"))
    assert binary is not None, "google-chrome is not installed"
    with tempfile.TemporaryDirectory(prefix="session-restore-infobar-") as directory:
        profile = Path(directory)
        profile_directory.prepare_user_data_dir(
            profile, preferences=preferences, local_state=local_state
        )
        proc = subprocess.Popen(
            [binary, f"--user-data-dir={directory}", "about:blank"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            env={**os.environ, "CHROME_LOG_FILE": "/dev/null"},
        )
        try:
            time.sleep(10)
            shot = out / f"{name}.png"
            with mss.MSS() as capture:
                capture.shot(mon=1, output=str(shot))
        finally:
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
        prefs = json.loads((profile / "Default" / "Preferences").read_text())
        stored = prefs.get("browser", {}).get(KEY)
    ink = bar_ink(shot)
    print(f"{name:16} infobar ink={ink:5}  {KEY} after exit={stored}")
    return ink


if __name__ == "__main__":
    out = Path(tempfile.mkdtemp(prefix="session-restore-infobar-shots-"))
    names = sys.argv[1:] or list(VARIANTS)
    for name in names:
        run(name, *VARIANTS[name], out)
    print("screenshots:", out)
