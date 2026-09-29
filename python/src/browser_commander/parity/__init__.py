"""Parity harness: the environment probe, its server and the reference capture.

:func:`browser_commander.browser.parity.measure_parity` builds on these to
compare a driven browser with the same binary started by hand (issue #103).
"""

from browser_commander.parity.harness import (
    IGNORED_PATHS,
    PROBE_SOURCE_PATH,
    ProbeReport,
    ProbeServer,
    build_reference_args,
    capture_reference_report,
    diff_reports,
    probe_expression,
    read_probe_source,
    start_probe_server,
)
from browser_commander.parity.version_page import (
    READ_VERSION_PAGE,
    CdpSocket,
    read_reference_version_page,
)

__all__ = [
    "IGNORED_PATHS",
    "PROBE_SOURCE_PATH",
    "READ_VERSION_PAGE",
    "CdpSocket",
    "ProbeReport",
    "ProbeServer",
    "build_reference_args",
    "capture_reference_report",
    "diff_reports",
    "probe_expression",
    "read_probe_source",
    "read_reference_version_page",
    "start_probe_server",
]
