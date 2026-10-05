"""Bounded Linux probe for Safari fixture isolation under a coarse wall clock.

Build the Rust safari_cookies integration test first, then run this script.
Only child-process CLOCK_REALTIME is coarsened; monotonic time remains real.
No real browser profile is accessed. The test process is limited to 512 MiB.
"""

import argparse
import os
import resource
import subprocess
import tempfile
from pathlib import Path


def bound_memory() -> None:
    limit = 512 * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (limit, limit))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=10)
    parser.add_argument("--log", type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= args.runs <= 100:
        parser.error("runs must be between 1 and 100")
    root = Path(__file__).resolve().parents[2]
    binaries = [
        path
        for path in (root / "rust/target/debug/deps").glob("safari_cookies-*")
        if path.is_file() and path.suffix != ".d" and os.access(path, os.X_OK)
    ]
    binary = max(binaries, key=lambda path: path.stat().st_mtime)
    failed = 0
    with tempfile.TemporaryDirectory(prefix="bc-coarse-clock-") as temporary:
        shim = Path(temporary) / "coarse_realtime.so"
        subprocess.run(
            [
                "cc",
                "-shared",
                "-fPIC",
                "-Wall",
                "-Wextra",
                "-Werror",
                str(Path(__file__).with_name("coarse_realtime.c")),
                "-ldl",
                "-o",
                str(shim),
            ],
            check=True,
        )
        environment = dict(os.environ, LD_PRELOAD=str(shim), RUST_BACKTRACE="1")
        with args.log.open("w") as log:
            for run in range(args.runs):
                log.write(f"Probe {run + 1}/{args.runs}\n")
                log.flush()
                result = subprocess.run(
                    [str(binary), "--test-threads=5", "--nocapture"],
                    env=environment,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    preexec_fn=bound_memory,
                    check=False,
                )
                failed += result.returncode != 0
    print(f"{failed}/{args.runs} probes failed; log: {args.log}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
