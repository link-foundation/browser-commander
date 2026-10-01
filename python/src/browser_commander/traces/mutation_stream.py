"""Streaming DOM mutations between checkpoints (issue #108).

A port of ``js/src/traces/mutation-stream.js``. The in-page recorder is the
``installMutationRecorderInPage`` function from ``assets.json``: it queues
mutation and live-state records inside each document, and the recorder drains
the queue at every checkpoint into ``mutations/NNNN.ndjson``.
"""

from __future__ import annotations

from collections.abc import Awaitable, Mapping
from typing import Any, Callable

from .bundle import TraceBundle
from .engine import EngineDriver, error_message, load_assets, with_deadline
from .identity import TraceIdentity
from .jsonfmt import coalesce, js_number
from .redaction import REDACTED, PrivacyOptions
from .schema import TraceDropReason, TraceEvent

#: How many records a document queues before it starts dropping them.
DEFAULT_MAX_QUEUED_MUTATIONS = 5000


class MutationStream:
    """Install, drain and stop the in-page mutation recorder."""

    def __init__(
        self,
        *,
        driver: EngineDriver,
        bundle: TraceBundle,
        record: Callable[[str, dict[str, Any]], Any],
        identity: TraceIdentity,
        note: Callable[[str], None],
        dom_options: Mapping[str, Any],
        privacy: PrivacyOptions,
        limits: Mapping[str, Any],
        capture_timeout_ms: float | None,
        evaluate_in_page: Callable[[str, Any], Awaitable[Any]],
    ) -> None:
        assets = load_assets()
        self._capture = assets["capture"]
        self._global = assets["recorderGlobal"]
        self._driver = driver
        self._bundle = bundle
        self._record = record
        self._identity = identity
        self._note = note
        self._timeout = capture_timeout_ms
        self._evaluate_in_page = evaluate_in_page
        self.enabled = bool(dom_options.get("mutations"))
        self.options = {
            "globalName": self._global,
            "redactSelectors": privacy.redact_selectors,
            "redacted": REDACTED,
            "maxQueued": coalesce(
                limits.get("maxQueuedMutations"), DEFAULT_MAX_QUEUED_MUTATIONS
            ),
            "liveState": dom_options.get("liveState") is not False,
        }

    async def _evaluate_in_frames(self, source: str, argument: Any) -> list[Any]:
        frames = self._driver.frames()
        if not frames:
            return [await self._evaluate_in_page(source, argument)]
        results = []
        for frame in frames:
            try:
                results.append(await self._driver.evaluate(source, argument, frame))
            except Exception:
                results.append(None)
        return [result for result in results if result is not None]

    def _dropped(
        self,
        member: str,
        error: BaseException | str,
        reason: str = TraceDropReason.CAPTURE_FAILED,
    ) -> None:
        detail = error if isinstance(error, str) else error_message(error)
        self._bundle.drop({"reason": reason, "member": member, "detail": detail})

    async def install(self) -> None:
        """Start recording in every frame the page has now."""
        if not self.enabled:
            return
        try:
            await self._evaluate_in_frames(
                self._capture["installMutationRecorder"], self.options
            )
        except Exception as error:
            self._dropped("mutation-recorder", error)

    async def install_persistent(self) -> Callable[[], Any] | None:
        """Start recording in every document the page loads from now on."""
        if not self.enabled:
            return None
        try:
            return await self._driver.install_init_script(
                self._capture["installMutationRecorder"], self.options, self._note
            )
        except Exception as error:
            self._dropped("mutation-recorder-init", error)
            return None

    async def drain(self, index: int) -> str | None:
        """Write what every frame queued since the last drain.

        Args:
            index: Checkpoint the batches follow

        Returns:
            The member written, or None
        """
        if not self.enabled:
            return None
        try:
            drained = await with_deadline(
                self._evaluate_in_frames(self._capture["drainMutations"], self._global),
                self._timeout,
                "trace mutation drain",
            )
            batches: list[dict[str, Any]] = []
            over = 0
            for frame in drained:
                if not isinstance(frame, Mapping):
                    continue
                over += coalesce(frame.get("dropped"), 0)
                for batch in frame.get("batches") or []:
                    # The identity of the trace comes from here and the
                    # identity of the document from inside it.
                    batches.append({**self._identity.owner(), **batch})

            if over:
                self._dropped(
                    "mutations",
                    f"{js_number(over)} records over the in-page queue limit",
                    TraceDropReason.SIZE_LIMIT,
                )

            # Frames are drained one by one, so the batches come back grouped
            # by frame; one ordered file is what a replay reads.
            batches.sort(key=lambda batch: coalesce(batch.get("at"), 0))

            member = self._bundle.write_mutations(index, batches)
            if member:
                self._record(
                    TraceEvent.MUTATIONS,
                    {
                        "member": member,
                        "batches": len(batches),
                        "checkpoint": index,
                        "frames": len(drained),
                    },
                )
            return member
        except Exception as error:
            self._dropped("mutations", error)
            return None

    async def stop(self) -> None:
        """Stop the in-page recorder in every frame."""
        if not self.enabled:
            return
        try:
            await self._evaluate_in_frames(
                self._capture["stopMutationRecorder"], self._global
            )
        except Exception as error:
            self._note(f"could not stop the in-page recorder: {error_message(error)}")
