"""Named, opt-in launch restrictions (issue #103).

By default Browser Commander starts Chrome exactly like a person would:
``--user-data-dir=<fresh profile> --remote-debugging-port=<reserved port>`` and
nothing else. Every switch the library used to add on its own - and every
switch an automation engine adds - is available here by name, so a caller who
wants one asks for it and the difference from a hand-started Chrome stays
visible in their code::

    await launch_browser(LaunchOptions(restrictions=["no-extensions", "no-sync"]))

The catalogue lives in ``launch-restrictions.json``; JavaScript and Rust ship
byte-identical copies, checked by ``scripts/check-shared-fingerprint-assets.sh``.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Any

_CATALOGUE_PATH = Path(__file__).parent / "launch-restrictions.json"


def _load_catalogue() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(_CATALOGUE_PATH.read_text(encoding="utf-8"))
    return data


_CATALOGUE = _load_catalogue()

#: Every restriction: ``id``, ``description`` and optional ``args``,
#: ``disableFeatures`` (merged into one ``--disable-features``) and ``env``
#: (for the browser process only).
LAUNCH_RESTRICTIONS: tuple[Mapping[str, Any], ...] = tuple(
    MappingProxyType(dict(entry)) for entry in _CATALOGUE["restrictions"]
)

#: Named groups of restrictions, such as the pre-#103 defaults.
LAUNCH_RESTRICTION_PRESETS: Mapping[str, tuple[str, ...]] = MappingProxyType(
    {name: tuple(ids) for name, ids in _CATALOGUE["presets"].items()}
)

_BY_ID = {entry["id"]: entry for entry in LAUNCH_RESTRICTIONS}


@dataclass(frozen=True)
class ResolvedRestrictions:
    """Switches and child environment for a set of restriction names."""

    ids: list[str] = field(default_factory=list)
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    preferences: dict[str, Any] = field(default_factory=dict)


def assert_string_array(value: Any, name: str) -> list[str]:
    """Raise :class:`TypeError` unless ``value`` is a list (or tuple) of strings.

    A bare string is rejected: iterating it would pass one switch per character.
    """

    if not isinstance(value, (list, tuple)) or any(
        not isinstance(item, str) for item in value
    ):
        msg = f"{name} must be a list of strings"
        raise TypeError(msg)
    return list(value)


def _expand(names: Sequence[str]) -> list[str]:
    ids: list[str] = []
    for name in assert_string_array(names, "restrictions"):
        ids.extend(LAUNCH_RESTRICTION_PRESETS.get(name, (name,)))
    return list(dict.fromkeys(ids))


def resolve_restrictions(
    names: Sequence[str] | None = None, *, disable_features: Sequence[str] = ()
) -> ResolvedRestrictions:
    """Resolve restriction names (and preset names) into switches and environment.

    Raises:
        ValueError: For a name that is neither a restriction nor a preset.
    """

    ids = _expand([] if names is None else names)
    args: list[str] = []
    features = assert_string_array(disable_features, "disable_features")
    preferences: dict[str, Any] = {}
    env: dict[str, str] = {}
    for restriction_id in ids:
        restriction = _BY_ID.get(restriction_id)
        if restriction is None:
            expected = ", ".join([*_BY_ID, *LAUNCH_RESTRICTION_PRESETS])
            msg = (
                f'Unknown launch restriction "{restriction_id}". '
                f"Expected one of {expected}"
            )
            raise ValueError(msg)
        args.extend(restriction.get("args", []))
        features.extend(restriction.get("disableFeatures", []))
        for key, value in restriction.get("preferences", {}).items():
            preferences[key] = (
                {**preferences.get(key, {}), **value}
                if isinstance(value, dict)
                else value
            )
        env.update(restriction.get("env", {}))
    if features:
        args.append(f"--disable-features={','.join(dict.fromkeys(features))}")
    return ResolvedRestrictions(ids=ids, args=args, env=env, preferences=preferences)


_LIST_SWITCHES = (
    "--disable-features",
    "--enable-features",
    "--disable-blink-features",
    "--enable-blink-features",
)


def _list_switch_of(argument: str) -> str | None:
    for prefix in _LIST_SWITCHES:
        if argument.startswith(f"{prefix}="):
            return prefix
    return None


def merge_feature_switches(args: Sequence[str]) -> list[str]:
    """Merge repeated feature-list switches into one occurrence each.

    Chrome keeps only the last ``--disable-features`` (and friends), so two
    sources that each add one would silently cancel each other. The merged
    switch takes the place of the first occurrence.
    """

    values: dict[str, list[str]] = {}
    for argument in args:
        name = _list_switch_of(argument)
        if name is not None:
            features = values.setdefault(name, [])
            for feature in argument[len(name) + 1 :].split(","):
                if feature and feature not in features:
                    features.append(feature)
    emitted: set[str] = set()
    merged: list[str] = []
    for argument in args:
        name = _list_switch_of(argument)
        if name is None:
            merged.append(argument)
        elif name not in emitted:
            emitted.add(name)
            merged.append(f"{name}={','.join(values[name])}")
    return merged


def browser_environment(
    restrictions: Sequence[str] | None = None,
    env: Mapping[str, str] | None = None,
) -> dict[str, str] | None:
    """Environment for the browser process only.

    Restriction environment (for example ``no-google-services``) and the
    caller's ``env`` are layered over this process's environment and handed to
    the child; :data:`os.environ` itself is never modified. ``None`` means
    "inherit unchanged".
    """

    restriction_env = resolve_restrictions(restrictions).env
    if env is None and not restriction_env:
        return None
    return {**os.environ, **restriction_env, **(env or {})}
