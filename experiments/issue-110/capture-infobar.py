"""Capture native Chrome/Edge windows under Xvfb before and after issue #107.

Run with:
  PYTHONPATH=python/src xvfb-run -a -s '-screen 0 1360x900x24' \
      python/.venv/bin/python experiments/issue-110/capture-infobar.py
Requires `pip install mss pillow`; writes browser-window evidence to docs/screenshots.
"""

from __future__ import annotations

import importlib.util
import os
import shutil
import signal
import subprocess
import tempfile
import time
from pathlib import Path

import mss
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PROFILE_MODULE = (
    ROOT / "python" / "src" / "browser_commander" / "browser" / "profile_directory.py"
)
spec = importlib.util.spec_from_file_location(
    "issue110_profile_directory", PROFILE_MODULE
)
assert spec is not None and spec.loader is not None
profile_directory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile_directory)
FIRST_RUN_SENTINEL = profile_directory.FIRST_RUN_SENTINEL
INITIAL_LOCAL_STATE = profile_directory.INITIAL_LOCAL_STATE
configure_user_data_dir = profile_directory.configure_user_data_dir
OUT = ROOT / "docs" / "screenshots" / "issue-110"
OUT.mkdir(parents=True, exist_ok=True)

for browser, executable in [("chrome", "google-chrome"), ("edge", "microsoft-edge")]:
    binary = shutil.which(executable)
    if binary is None:
        continue
    for state in ("before", "after"):
        with tempfile.TemporaryDirectory(
            prefix=f"issue-110-{browser}-{state}-"
        ) as directory:
            profile = Path(directory)
            (profile / FIRST_RUN_SENTINEL).touch()
            (profile / "Local State").write_text(
                __import__("json").dumps(
                    {key: dict(value) for key, value in INITIAL_LOCAL_STATE.items()}
                )
            )
            if state == "after":
                configure_user_data_dir(profile)
            proc = subprocess.Popen(
                [
                    binary,
                    f"--user-data-dir={directory}",
                    "--remote-debugging-port=19347",
                    "about:blank",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
                env={**os.environ, "CHROME_LOG_FILE": "/dev/null"},
            )
            try:
                time.sleep(10)
                with mss.MSS() as capture:
                    capture.shot(mon=1, output=str(OUT / f"{browser}-{state}.png"))
                print(browser, state, "exit=", proc.poll())
            finally:
                os.killpg(proc.pid, signal.SIGTERM)
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait()


def bar_ink(name: str) -> int:
    """Count dark/colored pixels in the infobar band of the X11 window."""
    with Image.open(OUT / name) as image:
        image = image.convert("RGB")
        return sum(
            min(pixel) < 220 or max(pixel) - min(pixel) > 10
            for y in range(108, 142)
            for x in range(50, 1030)
            for pixel in (image.getpixel((x, y)),)
        )


if shutil.which("google-chrome"):
    # A page screenshot omits browser chrome. These screenshots include the
    # full X11 window, so default-browser and automation infobars are visible.
    before = bar_ink("chrome-before.png")
    after = bar_ink("chrome-after.png")
    assert before > 1000, f"Chrome control capture has no prompt ({before} pixels)"
    assert after < 100, f"Chrome profile still has a browser infobar ({after} pixels)"
    print(f"Chrome window infobar pixels: before={before}, after={after}")
