"""Translated from ``js/tests/unit/fingerprint/limitations.test.js``.

The catalogue is a shared asset rather than a translation, so these tests are
mostly about the filter that decides which entries a caller has to read, plus
the one test that proves the asset shipped here is the asset JavaScript owns.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import pytest

from browser_commander.fingerprint.limitations import (
    FINGERPRINT_LIMITATIONS,
    find_fingerprint_limitation,
    relevant_fingerprint_limitations,
)

_REPO_ROOT = Path(__file__).resolve().parents[4]


def ids(limitations: Sequence[Mapping[str, Any]]) -> list[str]:
    return [limitation["id"] for limitation in limitations]


def relevant(profile: Mapping[str, Any] | None = None, **options: bool) -> list[str]:
    return ids(relevant_fingerprint_limitations(profile, **options))


class TestTheDocumentedLimitations:
    def test_gives_every_entry_a_unique_id_and_the_fields_a_reader_needs(self) -> None:
        seen: set[str] = set()
        for limitation in FINGERPRINT_LIMITATIONS:
            assert limitation["id"] not in seen, f"duplicate id {limitation['id']}"
            seen.add(limitation["id"])
            assert limitation["surface"], limitation["id"]
            assert limitation["detail"], limitation["id"]
            assert limitation["severity"] in {"high", "medium", "low"}
            assert limitation["evidence"] in {"measured", "documented"}

    def test_points_every_measured_entry_at_the_artifact_that_proves_it(self) -> None:
        for limitation in FINGERPRINT_LIMITATIONS:
            if limitation["evidence"] == "measured":
                assert limitation.get("reference"), f"{limitation['id']} needs one"

    def test_cannot_be_edited_by_a_caller(self) -> None:
        with pytest.raises(TypeError):
            FINGERPRINT_LIMITATIONS[0]["severity"] = "low"  # type: ignore[index]

    def test_ships_the_catalogue_that_the_javascript_package_owns(self) -> None:
        # The catalogue is data, not code, so the three packages ship one file
        # rather than three translations of the same eleven paragraphs.
        canonical = json.loads(
            (_REPO_ROOT / "js/src/fingerprint/limitations.json").read_text(
                encoding="utf-8"
            )
        )

        assert canonical == [dict(entry) for entry in FINGERPRINT_LIMITATIONS]

    def test_looks_an_entry_up_by_id(self) -> None:
        found = find_fingerprint_limitation("webgl-strings-only")

        assert found is not None
        assert found["surface"] == "WebGL renderer strings and driver limits"
        assert find_fingerprint_limitation("no-such-limitation") is None


class TestLimitationsRelevantToAProfile:
    def test_always_reports_the_two_nothing_can_be_done_about(self) -> None:
        assert relevant() == [
            "canvas-audio-font-follow-the-host",
            "network-layer-not-covered",
        ]

    def test_mentions_the_launch_only_switch_only_when_attaching(self) -> None:
        assert "automation-controlled-is-launch-only" not in relevant({})
        assert "automation-controlled-is-launch-only" in relevant({}, attached=True)

    def test_mentions_headless_only_for_a_headless_browser(self) -> None:
        assert "headless-is-distinguishable" in relevant({}, headless=True)
        assert "headless-is-distinguishable" not in relevant({})

    def test_mentions_the_javascript_only_fields_when_the_profile_sets_them(
        self,
    ) -> None:
        assert "no-cdp-device-memory-override" in relevant({"deviceMemory": 8})
        assert "no-cdp-vendor-or-dnt-override" in relevant({"doNotTrack": "1"})
        assert "webgl-strings-only" in relevant({"webgl": {"vendor": "WebKit"}})

    def test_mentions_the_screen_entry_only_for_the_fields_cdp_leaves_alone(
        self,
    ) -> None:
        assert "screen-depth-and-avail-not-emulated" not in relevant(
            {"screen": {"width": 1920, "height": 1080}}
        )
        assert "screen-depth-and-avail-not-emulated" in relevant(
            {"screen": {"width": 1920, "height": 1080, "availHeight": 1032}}
        )

    def test_mentions_the_pointer_side_effect_only_when_touch_is_enabled(self) -> None:
        assert "touch-emulation-changes-pointer-media" not in relevant(
            {"maxTouchPoints": 0}
        )
        assert "touch-emulation-changes-pointer-media" in relevant(
            {"maxTouchPoints": 5}
        )

    @pytest.mark.parametrize(
        "profile",
        [
            {"platform": "Win32"},
            {"languages": ["de-DE"]},
            {"hardwareConcurrency": 8},
            {"deviceMemory": 8},
        ],
    )
    def test_mentions_workers_for_every_field_a_worker_reads_differently(
        self, profile: Mapping[str, Any]
    ) -> None:
        # Measured in worker-visibility.json: platform, languages and
        # hardwareConcurrency revert to the host values inside a worker even
        # though the page session overrides them.
        assert "init-script-does-not-reach-workers" in relevant(profile)

    def test_leaves_workers_out_when_nothing_a_worker_reads_is_set(self) -> None:
        assert "init-script-does-not-reach-workers" not in relevant(
            {"timezoneId": "UTC"}
        )

    def test_keeps_the_declaration_order(self) -> None:
        selected = relevant(
            {"deviceMemory": 8, "webgl": {"vendor": "WebKit"}},
            headless=True,
            attached=True,
        )

        assert selected == [
            limitation["id"]
            for limitation in FINGERPRINT_LIMITATIONS
            if limitation["id"] in set(selected)
        ]
