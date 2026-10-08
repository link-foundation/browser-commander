"""Stable launch failure categories with bounded, redacted evidence."""

import re
from typing import Any


def redact_launch_evidence(value: Any, redactor=None) -> str:
    text = re.sub(r"(?:[A-Za-z]:\\|/)[^\s:;\"'<>]+", "[path]", str(value or ""))
    text = re.sub(
        r"\b(token|password|secret|authorization|cookie)\s*[=:]\s*[^\s,;]+",
        r"\1=[redacted]",
        text,
        flags=re.I,
    )
    if redactor:
        try:
            text = str(redactor(text))
        except Exception:
            text = "[diagnostic redaction failed]"
    return text[-4096:]


class LaunchCause(RuntimeError):
    original_type: str


class BrowserLaunchError(RuntimeError):
    """Evidence is safe to expose; ``__cause__`` retains a scrubbed cause."""

    def __init__(
        self,
        *,
        phase,
        engine,
        category,
        exit_code=None,
        signal=None,
        stderr_tail="",
        cause=None,
    ):
        detail = stderr_tail or str(cause or "")
        super().__init__(f"Browser launch failed ({phase}: {category}): {detail}")
        self.phase = phase
        self.engine = engine
        self.category = category
        self.exit_code = exit_code
        self.signal = signal
        self.stderr_tail = stderr_tail
        self.__cause__ = cause
        self.__suppress_context__ = True


def launch_failure(error, *, phase, options, process=None):
    if isinstance(error, BrowserLaunchError):
        return error
    code = getattr(process, "exit_code", None)
    raw = str(error)
    category = "configuration"
    if isinstance(error, FileNotFoundError) or re.search(
        r"not found|does not exist|not an executable|not accessible|could not find an installed|no .*executable",
        raw,
        re.I,
    ):
        category = "missing_executable"
    elif type(error).__name__ == "PortRaceError":
        category = "port_race"
    elif isinstance(error, TimeoutError) or re.search(r"timed out|timeout", raw, re.I):
        category = "startup_timeout"
    elif code is not None:
        category = "early_exit"

    def scrub(value):
        return redact_launch_evidence(value, options.diagnostic_redactor)

    cause = LaunchCause(scrub(raw))
    cause.original_type = type(error).__name__
    return BrowserLaunchError(
        phase=phase,
        engine=options.engine,
        category=category,
        exit_code=code if code is None or code >= 0 else None,
        signal=-code if code is not None and code < 0 else None,
        stderr_tail=scrub(getattr(process, "stderr_tail", "")),
        cause=cause,
    )
