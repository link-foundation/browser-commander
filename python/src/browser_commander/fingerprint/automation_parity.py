"""Keep ``navigator.webdriver`` false by disabling the Blink feature behind it.

Chrome tells a page that it is automated through exactly one Blink runtime
feature: ``AutomationControlled``. ``navigator.webdriver`` is that feature and
nothing else, so closing the gap between a hand-started Chrome and a
Browser Commander Chrome is a matter of knowing which switches turn it on.

``content/child/runtime_features.cc`` in Chromium maps switches onto the
feature in ``SetRuntimeFeaturesFromCommandLine``::

    {wrf::EnableAutomationControlled, switches::kEnableAutomation, true},
    {wrf::EnableAutomationControlled, switches::kHeadless, true},
    {wrf::EnableAutomationControlled, switches::kRemoteDebuggingPipe, true},

plus a special case directly below it: ``--remote-debugging-port=0`` also
enables the feature, because an ephemeral port is how ChromeDriver launches the
browser. A specific port number is left alone on purpose, since that is what a
human attaching a debugger passes.

https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/child/runtime_features.cc

This module is the Python side of the same table as
``js/src/fingerprint/automation-parity.js`` and
``rust/src/fingerprint/automation_parity.rs``; the three are kept in step by
tests that assert the same switches and the same merge behaviour.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

#: Switch that disables the Blink feature regardless of what turned it on.
AUTOMATION_CONTROLLED_OFF_ARG = "--disable-blink-features=AutomationControlled"

_BLINK_FEATURES_SWITCH = "--disable-blink-features"
_REMOTE_DEBUGGING_PORT_SWITCH = "--remote-debugging-port"


@dataclass(frozen=True)
class AutomationTrigger:
    """A Chrome switch that enables the ``AutomationControlled`` feature."""

    switch: str
    reason: str


@dataclass(frozen=True)
class DetectedTrigger:
    """A trigger found in a concrete command line, with the argument seen."""

    switch: str
    argument: str
    reason: str


#: Chrome switches that enable the ``AutomationControlled`` Blink feature.
AUTOMATION_CONTROLLED_TRIGGERS = (
    AutomationTrigger(
        switch="--enable-automation",
        reason=(
            "Mapped onto AutomationControlled in content/child/runtime_features.cc; "
            'also shows the "controlled by automated test software" infobar.'
        ),
    ),
    AutomationTrigger(
        switch="--headless",
        reason=(
            "Mapped onto AutomationControlled in content/child/runtime_features.cc; "
            "covers --headless and --headless=new alike."
        ),
    ),
    AutomationTrigger(
        switch="--remote-debugging-pipe",
        reason=(
            "Mapped onto AutomationControlled in content/child/runtime_features.cc. "
            "Playwright always passes it, and Puppeteer passes it whenever pipe "
            "transport is selected."
        ),
    ),
    AutomationTrigger(
        switch="--remote-debugging-port=0",
        reason=(
            "An ephemeral debugging port is how ChromeDriver launches Chrome, so "
            "runtime_features.cc treats it as automation. A fixed non-zero port is "
            "deliberately not treated that way. Puppeteer defaults to port 0."
        ),
    ),
)


def _switch_name(argument: str) -> str:
    """Return the switch part of ``--name=value``, or the argument itself."""

    return argument.split("=", 1)[0]


def _is_ephemeral_debugging_port(argument: str) -> bool:
    if _switch_name(argument) != _REMOTE_DEBUGGING_PORT_SWITCH:
        return False
    _, _, value = argument.partition("=")
    try:
        return int(value.strip()) == 0
    except ValueError:
        return False


def _is_trigger(argument: str, trigger: AutomationTrigger) -> bool:
    if trigger.switch == "--remote-debugging-port=0":
        return _is_ephemeral_debugging_port(argument)
    if trigger.switch == "--headless":
        return _switch_name(argument) == "--headless"
    return _switch_name(argument) == trigger.switch


def detect_automation_controlled_triggers(
    args: Sequence[str] | None = None,
) -> list[DetectedTrigger]:
    """Report which of the supplied switches would make ``navigator.webdriver`` true.

    Callers use this to explain a parity failure instead of only observing it.

    Args:
        args: Chrome command line switches.

    Returns:
        Every trigger found, in the order the arguments were given.

    Raises:
        TypeError: If ``args`` is not a sequence of strings.
    """

    arguments = _validated(args)
    return [
        DetectedTrigger(switch=trigger.switch, argument=argument, reason=trigger.reason)
        for argument in arguments
        for trigger in AUTOMATION_CONTROLLED_TRIGGERS
        if _is_trigger(argument, trigger)
    ]


def disables_automation_controlled(args: Sequence[str] | None = None) -> bool:
    """Return whether the switch list already disables the feature."""

    for argument in _validated(args):
        if _switch_name(argument) != _BLINK_FEATURES_SWITCH:
            continue
        _, _, features = argument.partition("=")
        if any(
            feature.strip() == "AutomationControlled" for feature in features.split(",")
        ):
            return True
    return False


def apply_automation_parity_args(args: Sequence[str] | None = None) -> list[str]:
    """Append the switch that keeps ``navigator.webdriver`` false.

    The feature is disabled rather than the triggering switches removed: an
    engine adds ``--remote-debugging-pipe`` or ``--remote-debugging-port=0``
    after the caller's arguments and needs that transport to work at all, so the
    only reliable place to intervene is the feature itself.

    Args:
        args: Chrome switches assembled so far.

    Returns:
        The switches with automation parity applied.
    """

    arguments = _validated(args)
    if disables_automation_controlled(arguments):
        return list(arguments)
    for index, argument in enumerate(arguments):
        if _switch_name(argument) == _BLINK_FEATURES_SWITCH:
            # Chrome keeps only the last --disable-blink-features occurrence, so
            # the existing feature list is extended in place, not duplicated.
            merged = list(arguments)
            merged[index] = f"{argument},AutomationControlled"
            return merged
    return [*arguments, AUTOMATION_CONTROLLED_OFF_ARG]


#: Playwright forces a mouse-like pointer in headless Chrome::
#:
#:     if (options.headless) {
#:       chromeArguments.push("--headless");
#:       chromeArguments.push(
#:         "--hide-scrollbars",
#:         "--mute-audio",
#:         "--blink-settings=primaryHoverType=2,availableHoverTypes=2," +
#:           "primaryPointerType=4,availablePointerTypes=4");
#:     }
#:
#: -- packages/playwright-core/src/server/chromium/chromium.ts. Headless Chrome
#: has no pointing device, so a real headless browser answers ``hover: none``
#: and ``pointer: none``; with that switch it answers ``hover: hover`` and
#: ``pointer: fine``, a four-media-query giveaway no page script can explain
#: away. Measured in
#: docs/case-studies/issue-79/analysis-artifacts/parity-headless.json.
PLAYWRIGHT_HEADLESS_POINTER_ARG = (
    "--blink-settings=primaryHoverType=2,availableHoverTypes=2,"
    "primaryPointerType=4,availablePointerTypes=4"
)

#: Playwright turns on software WebGL for every launch:
#:
#:     const chromeArguments = [...chromiumSwitches()];
#:     chromeArguments.push('--enable-unsafe-swiftshader');
#:
#: -- packages/playwright-core/src/server/chromium/chromium.ts. Until 1.62 the
#: push was guarded by ``os.platform() === 'darwin'``; it is now unconditional.
#:
#: The switch tells Chrome to fall back to the SwiftShader software renderer
#: when no usable GPU is present, which a hand-started Chrome refuses to do. On
#: a machine without a GPU -- a container, a VM, a CI runner -- the difference
#: is total: ``canvas.getContext('webgl')`` answers ``None`` in a real browser
#: and a full context under Playwright, complete with the ANGLE/SwiftShader
#: vendor and renderer strings. Measured in
#: docs/case-studies/issue-79/analysis-artifacts/parity-webgl-swiftshader.json.
#:
#: It has to be suppressed in headless too. Headless Chrome enables SwiftShader
#: on its own, so removing the switch changes nothing there -- but leaving it in
#: the headless list only would mean a headful launch kept it.
PLAYWRIGHT_SOFTWARE_WEBGL_ARG = "--enable-unsafe-swiftshader"

#: Default switches an engine adds that a hand-started Chrome does not have.
#:
#: These cannot be countered after launch: they have to be kept out of the
#: command line through the engine's own exclusion option -- ``ignore_default_args``
#: for Playwright, ``excludeSwitches`` for Selenium's ChromeDriver.
ENGINE_PARITY_IGNORED_DEFAULT_ARGS: dict[str, dict[str, tuple[str, ...]]] = {
    "playwright": {
        "always": ("--enable-automation", PLAYWRIGHT_SOFTWARE_WEBGL_ARG),
        "headless": (PLAYWRIGHT_HEADLESS_POINTER_ARG,),
    },
    "selenium": {
        "always": ("--enable-automation",),
        "headless": (),
    },
}


def parity_ignored_default_args(engine: str, *, headless: bool = False) -> list[str]:
    """Default switches to suppress so the command line matches a real Chrome.

    Args:
        engine: Automation engine in use, ``"playwright"`` or ``"selenium"``.
        headless: Whether the browser runs headless.

    Returns:
        The switches to exclude at launch.

    Raises:
        ValueError: If the engine is not one this table knows.
    """

    entry = ENGINE_PARITY_IGNORED_DEFAULT_ARGS.get(engine)
    if entry is None:
        known = ", ".join(sorted(ENGINE_PARITY_IGNORED_DEFAULT_ARGS))
        msg = f'unknown engine "{engine}"; expected one of {known}'
        raise ValueError(msg)
    return [*entry["always"], *(entry["headless"] if headless else ())]


def _validated(args: Sequence[str] | None) -> list[str]:
    if args is None:
        return []
    if isinstance(args, str) or not isinstance(args, Sequence):
        msg = "args must be a sequence of strings"
        raise TypeError(msg)
    for argument in args:
        if not isinstance(argument, str):
            msg = "args must be a sequence of strings"
            raise TypeError(msg)
    return list(args)
