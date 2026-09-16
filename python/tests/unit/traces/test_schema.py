"""Unit tests for the portable trace format's Python half (issue #87)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from browser_commander.traces.schema import (
    TRACE_FORMAT,
    TRACE_SCHEMA_VERSION,
    TraceMode,
    TraceOutcome,
    assert_readable_manifest,
    create_manifest,
    sequence_name,
)

#: The JavaScript half of the same agreement.
JS_SCHEMA = Path(__file__).resolve().parents[4] / "js" / "src" / "traces" / "schema.js"


class TestSequenceName:
    """Members sort the way the sequence ran."""

    @pytest.mark.parametrize(
        ("index", "expected"),
        [(1, "0001"), (42, "0042"), (10000, "10000")],
    )
    def test_pads_to_four_digits_without_truncating(
        self, index: int, expected: str
    ) -> None:
        assert sequence_name(index) == expected


class TestCreateManifest:
    """The manifest describes the run the same way in either language."""

    def test_stamps_the_format_and_version_a_reader_checks(self) -> None:
        manifest = create_manifest(mode=TraceMode.CHECKPOINTS)

        assert manifest["format"] == TRACE_FORMAT
        assert manifest["schemaVersion"] == TRACE_SCHEMA_VERSION
        assert manifest["outcome"] == TraceOutcome.COMPLETE

    def test_counts_every_kind_even_when_none_was_written(self) -> None:
        manifest = create_manifest(mode=TraceMode.CONTINUOUS, counts={"events": 7})

        assert manifest["counts"] == {
            "checkpoints": 0,
            "events": 7,
            "mutationBatches": 0,
        }

    def test_records_the_runtime_that_wrote_it(self) -> None:
        manifest = create_manifest(mode=TraceMode.CHECKPOINTS)

        assert manifest["runtime"].startswith("python ")

    def test_is_json_the_javascript_reader_accepts(self) -> None:
        # Every value has to survive a round trip through the file, because the
        # bundle is read by a different language than the one that wrote it.
        manifest = create_manifest(mode=TraceMode.CHECKPOINTS, engine="playwright")

        assert json.loads(json.dumps(manifest)) == manifest


class TestAssertReadableManifest:
    """A reader refuses what it cannot honestly read."""

    def test_accepts_the_version_it_was_written_for(self) -> None:
        assert_readable_manifest(create_manifest(mode=TraceMode.CHECKPOINTS))

    @pytest.mark.parametrize("manifest", [None, {}, {"format": "har"}])
    def test_refuses_something_that_is_not_a_trace(self, manifest: object) -> None:
        with pytest.raises(ValueError, match="not a Browser Commander trace bundle"):
            assert_readable_manifest(manifest)

    def test_refuses_a_version_it_does_not_know(self) -> None:
        with pytest.raises(ValueError, match="newer than this reader"):
            assert_readable_manifest(
                {"format": TRACE_FORMAT, "schemaVersion": TRACE_SCHEMA_VERSION + 1}
            )


class TestCrossLanguageAgreement:
    """The two halves of the format are kept in step by hand, so check them."""

    @pytest.mark.skipif(not JS_SCHEMA.exists(), reason="JavaScript package not present")
    def test_declares_the_same_schema_version_as_javascript(self) -> None:
        source = JS_SCHEMA.read_text(encoding="utf-8")

        assert f"TRACE_SCHEMA_VERSION = {TRACE_SCHEMA_VERSION};" in source
