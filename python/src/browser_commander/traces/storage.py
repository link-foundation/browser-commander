"""Compression of closed members; active NDJSON stays readable after a crash."""

import gzip
from pathlib import Path


def gzip_trace(root):
    for file in Path(root).rglob("*.ndjson"):
        temporary = file.with_name(file.name + ".gz.tmp")
        with file.open("rb") as source, gzip.open(temporary, "wb") as target:
            while chunk := source.read(64 * 1024):
                target.write(chunk)
        temporary.chmod(0o600)
        temporary.replace(file.with_name(file.name + ".gz"))
        file.unlink()
