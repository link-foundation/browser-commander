"""Rotation at synchronous write boundaries, shared by all trace producers."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from .bundle import TraceBundle, write_private_file
from .schema import create_manifest


class RollingBundle(TraceBundle):
    def __init__(self, output, *, limits, **options):
        self.root = str(Path(output).resolve())
        self._limits, self._options = dict(limits), options
        config = {} if limits["rotate"] is True else limits["rotate"]
        self._max_bytes = config.get(
            "maxBytes", limits.get("maxBundleBytes", 32 * 1024 * 1024)
        )
        self._max_segments = config.get("maxSegments")
        if (
            not isinstance(self._max_bytes, int)
            or self._max_bytes < 1024
            or (
                self._max_segments is not None
                and (
                    not isinstance(self._max_segments, int)
                    or not 1 <= self._max_segments <= 100
                )
            )
        ):
            raise ValueError("invalid trace rotation bounds")
        self._segments: list[str] = []
        self._writers: list[TraceBundle] = []
        self._number = 0
        self._event_sequence = 0
        self._pinned: str | bool = False
        self._base: dict[str, Any] | None = None
        self._base_event: dict[str, Any] | None = None
        Path(self.root).mkdir(parents=True, exist_ok=True, mode=0o700)
        if config.get("lazy"):
            self._current = TraceBundle(
                self.root,
                next_sequence=self._next_sequence,
                limits={
                    **self._limits,
                    "rotate": False,
                    "maxBundleBytes": float("inf"),
                },
                **self._options,
            )
            self._writers.append(self._current)
        else:
            self._open()

    def _open(self):
        self._number += 1
        name = f"segment-{self._number:06d}"
        self._current = TraceBundle(
            Path(self.root) / name,
            next_sequence=self._next_sequence,
            limits={**self._limits, "rotate": False, "maxBundleBytes": float("inf")},
            **self._options,
        )
        self._writers.append(self._current)
        self._segments.append(name)
        if self._max_segments and len(self._segments) > self._max_segments:
            shutil.rmtree(Path(self.root) / self._segments.pop(0))
        temporary = Path(self.root) / "segments.json.tmp"
        write_private_file(temporary, json.dumps({"segments": self._segments}).encode())
        temporary.replace(Path(self.root) / "segments.json")

    def _prepare(self, size: int, carry=False):
        if (
            not self._pinned
            and self._current.bytes_written
            and self._current.bytes_written + size > self._max_bytes
        ):
            self._current.close(
                create_manifest(mode="continuous" if self._base else "checkpoints")
            )
            if self._number == 0:
                name = "segment-000001"
                destination = Path(self.root) / name
                destination.mkdir(mode=0o700)
                for member in (
                    "events.ndjson",
                    "manifest.json",
                    "checkpoints",
                    "mutations",
                    "artifacts",
                    "viewer.html",
                ):
                    source = Path(self.root) / member
                    if source.exists():
                        source.rename(destination / member)
                self._number = 1
                self._segments.append(name)
            self._open()
            if carry and self._base and self._base_event:
                members = self._current.write_checkpoint(**self._base)
                self._current.append_event(
                    {
                        **self._base_event,
                        "members": members,
                        "reason": "rotation-base",
                    }
                )

    def _next_sequence(self):
        self._event_sequence += 1
        return self._event_sequence

    @property
    def current_root(self):
        return self._current.root

    @property
    def segments(self):
        return list(self._segments)

    @property
    def bytes_written(self):
        return self._current.bytes_written

    @property
    def dropped(self):
        return sum(writer.dropped for writer in self._writers)

    @property
    def counts(self):
        return {
            key: sum(writer.counts[key] for writer in self._writers)
            for key in ("checkpoints", "events", "mutationBatches")
        }

    @property
    def problems(self):
        return [problem for writer in self._writers for problem in writer.problems]

    @property
    def mutation_truncated(self):
        return self._current.mutation_truncated

    def append_event(self, event, **options):
        self._prepare(len(json.dumps(event).encode()) + 256, True)
        result = self._current.append_event(event, **options)
        if event.get("kind") == "checkpoint":
            self._base_event = result
        if event.get("kind") == "checkpoint" or (
            event.get("kind") == "mutations" and self._pinned == "mutations"
        ):
            self._pinned = False
        return result

    def write_checkpoint(self, index, html=None, state=None, screenshot=None):
        self._prepare(
            len((html or "").encode())
            + len(json.dumps(state).encode())
            + len(screenshot or b"")
            + 1024
        )
        self._pinned = "checkpoint"
        self._base = {
            "index": index,
            "html": html,
            "state": state,
            "screenshot": screenshot,
        }
        return self._current.write_checkpoint(**self._base)

    def write_mutations(self, index, batches):
        self._prepare(len(json.dumps(batches).encode()) + 256, True)
        result = self._current.write_mutations(index, batches)
        if self._pinned != "checkpoint":
            self._pinned = "mutations" if result else False
        return result

    def write_member(self, member, contents, **options):
        self._prepare(len(contents.encode() if isinstance(contents, str) else contents))
        return self._current.write_member(member, contents, **options)

    def write_artifact(self, contents, extension=""):
        self._prepare(len(contents.encode() if isinstance(contents, str) else contents))
        result = self._current.write_artifact(contents, extension)
        if result and self._segments:
            result["member"] = f"{self._segments[-1]}/{result['member']}"
        return result

    def drop(self, record):
        return self._current.drop(record)

    def abort(self):
        return self._current.abort()

    def close(self, manifest):
        manifest = self._current.close(manifest)
        if self.dropped:
            manifest["outcome"] = "partial"
        for segment in self._segments:
            file = Path(self.root) / segment / "manifest.json"
            previous = json.loads(file.read_text())
            write_private_file(
                file,
                json.dumps(
                    {
                        **manifest,
                        "counts": previous["counts"],
                        "dropped": previous["dropped"],
                    }
                ).encode(),
            )
        return {**manifest, "counts": self.counts, "dropped": self.dropped}
