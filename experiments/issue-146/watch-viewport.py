"""Bounded compositor regression: run under Xvfb with Pillow's XCB support.

Samples actual displayed page pixels, independently of the page screenshot API.
Run: xvfb-run -a -s '-screen 0 900x700x24' python experiments/issue-146/watch-viewport.py
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

from PIL import ImageChops, ImageGrab

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/screenshots"


def main() -> None:
    with subprocess.Popen(
        ["node", str(ROOT / "experiments/issue-146/stable-viewport.mjs")],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    ) as process:
        assert process.stdout is not None and process.stdin is not None
        try:
            ready = json.loads(process.stdout.readline())
            assert ready["ready"] and ready["geometry"]["y"] == 4081
            baseline = ImageGrab.grab(xdisplay=os.environ["DISPLAY"])
            OUT.mkdir(parents=True, exist_ok=True)
            baseline.save(OUT / "issue-146-viewport-before.png")
            # Observe the visible content independently of Chromium's capture pipeline.
            region = (40, 180, 760, 600)
            reference = baseline.crop(region).convert("RGB")
            process.stdin.write("capture\n")
            process.stdin.flush()
            changed = 0
            for _ in range(120):
                frame = ImageGrab.grab(xdisplay=os.environ["DISPLAY"])
                if ImageChops.difference(
                    reference, frame.crop(region).convert("RGB")
                ).getbbox():
                    changed += 1
                time.sleep(1 / 60)
            frame.save(OUT / "issue-146-viewport-after.png")
            process.stdin.write("stop\n")
            process.stdin.flush()
            captured = json.loads(process.stdout.readline())
            result = json.loads(process.stdout.readline())
            assert captured["captured"] and result["geometryUnchanged"]
            assert process.wait() == 0
            assert changed == 0, (
                f"{changed}/120 displayed frames changed during capture"
            )
            print(
                json.dumps(
                    {**result, "displaySamples": 120, "changedDisplaySamples": changed}
                )
            )
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait()


if __name__ == "__main__":
    main()
