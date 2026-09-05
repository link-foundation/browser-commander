"""Regression tests for the Python dependency audit.

The audit is a gate, so its two failure modes are both silent: auditing the
wrong surface (the installer instead of the package) reports vulnerabilities
nobody can act on, and capturing pip-audit's stdout hides the advisory table
behind a bare exit status. Both were observed on the first local run and both
are pinned here.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parents[3] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import audit_dependencies  # noqa: E402
from audit_dependencies import project_install_target  # noqa: E402

PROJECT_ROOT = SCRIPTS_DIR.parent


def test_install_target_covers_every_declared_extra() -> None:
    """A vulnerability in an optional driver still reaches users of that extra."""
    target = project_install_target(PROJECT_ROOT)

    assert target.startswith(".[")
    for extra in ("all", "dev", "playwright", "selenium"):
        assert extra in target


def test_install_target_without_extras(tmp_path: Path) -> None:
    """A package with no extras installs plainly, without an empty bracket."""
    (tmp_path / "pyproject.toml").write_text(
        '[project]\nname = "demo"\nversion = "1.0.0"\n', encoding="utf-8"
    )

    assert project_install_target(tmp_path) == "."


def test_missing_dependency_surface_is_reported(tmp_path: Path) -> None:
    """An audit that finds nothing to audit must fail, not pass quietly."""
    with pytest.raises(FileNotFoundError, match=r"pyproject\.toml"):
        audit_dependencies.audit_dependencies(tmp_path)


def test_installer_is_not_part_of_the_audited_surface(monkeypatch) -> None:
    """pip lives in the venv, not in the package's dependency closure.

    With a plain `python -m venv`, pip-audit reported PYSEC-2026-3721 against
    pip itself and failed the job for a package this repository neither
    declares nor ships.
    """
    commands: list[list[str]] = []

    def fake_run(command, *, cwd, capture=False):
        commands.append(list(command))
        return ""

    monkeypatch.setattr(audit_dependencies, "run", fake_run)
    audit_dependencies.audit_dependencies(PROJECT_ROOT)

    venv_commands = [c for c in commands if "venv" in c]
    target_venv = venv_commands[0]
    assert "--without-pip" in target_venv
    assert target_venv[-1].endswith("target")

    installs = [c for c in commands if "install" in c]
    project_install = installs[0]
    assert project_install[0] == sys.executable
    assert "--python" in project_install
    assert project_install[project_install.index("--python") + 1].endswith(
        str(Path("target") / "bin" / "python")
    ) or project_install[project_install.index("--python") + 1].endswith(
        str(Path("target") / "Scripts" / "python.exe")
    )


def test_audit_output_is_streamed_not_captured(monkeypatch) -> None:
    """Only the site-packages query captures; the audit itself must stream.

    `subprocess.run(check=True)` raises before captured text is printed, so a
    captured audit leaves the CI log with an exit status and no advisory.
    """
    captured_flags: list[tuple[bool, list[str]]] = []

    def fake_run(command, *, cwd, capture=False):
        captured_flags.append((capture, list(command)))
        return ""

    monkeypatch.setattr(audit_dependencies, "run", fake_run)
    audit_dependencies.audit_dependencies(PROJECT_ROOT)

    audit_calls = [
        (capture, command)
        for capture, command in captured_flags
        if "pip_audit" in command
    ]
    assert audit_calls, "the audit never ran pip_audit"
    for capture, _ in audit_calls:
        assert capture is False
