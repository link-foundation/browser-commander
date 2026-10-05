"""Validate inputs and immutable-source boundaries before target writes."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path

from browser_commander.browser.browser_sources import browser_family
from browser_commander.browser.migration.domains import validate_domains
from browser_commander.browser.system_browser import assert_dedicated_user_data_dir


def validate_migration_options(
    *,
    include: Sequence[str],
    domains: Sequence[str] | None,
    target_browser: str | None,
    to: Path,
    platform: str,
    home_dir: Path,
    environment: Mapping[str, str],
    classes: Sequence[str],
    include_payment_cards: bool = False,
) -> None:
    if not isinstance(include_payment_cards, bool):
        raise TypeError("include_payment_cards must be a boolean")
    if any(type_ not in classes for type_ in include):
        raise ValueError(
            f"include must contain supported data classes: {', '.join(classes)}"
        )
    validate_domains(domains)
    if target_browser and browser_family(target_browser) != "chromium":
        raise ValueError(
            f"Migration target {target_browser} does not yet have a supported target file writer"
        )
    assert_dedicated_user_data_dir(
        to, platform=platform, home_dir=home_dir, environment=environment
    )


def validate_migration_paths(source: Path, target: Path) -> None:
    source = source.resolve()
    target = target.resolve()
    if source == target or source in target.parents or target in source.parents:
        raise ValueError("Migration source and target directories must not overlap")
