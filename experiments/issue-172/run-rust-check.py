"""Run one bounded-concurrency Rust check and report peak child RSS."""

import os
import resource
import subprocess
import sys

environment = dict(os.environ)
environment.update(
    CARGO_BUILD_JOBS="1",
    CARGO_INCREMENTAL="0",
    CARGO_PROFILE_DEV_DEBUG="0",
    CARGO_PROFILE_TEST_DEBUG="0",
)
result = subprocess.run(["cargo", *sys.argv[1:]], env=environment, check=False)
print(f"Peak child RSS: {resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss} KiB")
sys.exit(result.returncode)
