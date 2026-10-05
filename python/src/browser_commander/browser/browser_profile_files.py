"""Resolve companion files for single-profile and nested browser layouts."""

from __future__ import annotations

from pathlib import Path


def local_state_path_for_profile(profile_dir: str | Path) -> Path:
    """Prefer Opera's Local State inside the profile over a parent's file."""
    profile = Path(profile_dir)
    own = profile / "Local State"
    return own if own.exists() else profile.parent / "Local State"
