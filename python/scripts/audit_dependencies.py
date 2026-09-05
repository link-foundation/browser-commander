#!/usr/bin/env python3
"""Resolve and audit every Python dependency surface this package ships.

`pip-audit` can only report on packages it can see. Auditing the environment
that runs the audit would report pip-audit's own dependency tree, so this
script resolves the project into one throwaway virtual environment and runs
pip-audit from a second one, pointed at the first one's site-packages.

Every declared extra is installed, because a vulnerability in an optional
driver (playwright, selenium) reaches users who ask for that extra.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

import tomllib

PIP_AUDIT_VERSION = "2.10.1"
DEPENDENCY_SURFACES = ("pyproject.toml",)


def run(command: list[str], *, cwd: Path, capture: bool = False) -> str:
    """Run a command, failing the audit when dependency resolution fails.

    Output is streamed by default. Capturing it would hide the pip-audit table
    on the run that matters: `subprocess.run(check=True)` raises before the
    captured text is printed, leaving the job log with an exit status and no
    advisory. Only the caller that needs a value back asks for `capture`.
    """
    completed = subprocess.run(
        command,
        cwd=cwd,
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
    )
    if not capture:
        return ""
    output = completed.stdout.strip()
    if output:
        print(output)
    return output


def python_executable(venv: Path) -> Path:
    """Return the Python executable for a virtual environment."""
    scripts_directory = "Scripts" if sys.platform == "win32" else "bin"
    executable = "python.exe" if sys.platform == "win32" else "python"
    return venv / scripts_directory / executable


def project_install_target(project_root: Path) -> str:
    """Build an install target that resolves every declared optional extra."""
    pyproject_path = project_root / "pyproject.toml"
    with pyproject_path.open("rb") as pyproject_file:
        pyproject = tomllib.load(pyproject_file)
    extras = sorted(pyproject.get("project", {}).get("optional-dependencies", {}))
    return f".[{','.join(extras)}]" if extras else "."


def audit_dependencies(project_root: Path) -> None:
    """Resolve application dependencies in isolation and audit the result."""
    missing = [
        surface
        for surface in DEPENDENCY_SURFACES
        if not (project_root / surface).is_file()
    ]
    if missing:
        message = f"Unmapped or missing dependency surfaces: {', '.join(missing)}"
        raise FileNotFoundError(message)

    with tempfile.TemporaryDirectory(prefix="dependency-audit-") as temporary:
        temporary_root = Path(temporary)
        target_venv = temporary_root / "target"
        audit_venv = temporary_root / "audit"
        # `--without-pip`: pip and setuptools are the installer, not something
        # this package declares or ships. Leaving them in the target
        # environment makes every advisory against pip itself fail the audit -
        # PYSEC-2026-3721 (pip < 26.2) did exactly that on the first run - which
        # is a false positive against this repository's dependency surface.
        run(
            [sys.executable, "-m", "venv", "--without-pip", str(target_venv)],
            cwd=project_root,
        )
        run([sys.executable, "-m", "venv", str(audit_venv)], cwd=project_root)

        target_python = python_executable(target_venv)
        audit_python = python_executable(audit_venv)
        run(
            [
                sys.executable,
                "-m",
                "pip",
                "--python",
                str(target_python),
                "install",
                project_install_target(project_root),
            ],
            cwd=project_root,
        )
        run(
            [
                str(audit_python),
                "-m",
                "pip",
                "install",
                f"pip-audit=={PIP_AUDIT_VERSION}",
            ],
            cwd=project_root,
        )
        site_packages = run(
            [
                str(target_python),
                "-c",
                "import sysconfig; print(sysconfig.get_paths()['purelib'])",
            ],
            cwd=project_root,
            capture=True,
        )
        run(
            [
                str(audit_python),
                "-m",
                "pip_audit",
                "--path",
                site_packages,
                "--skip-editable",
            ],
            cwd=project_root,
        )


if __name__ == "__main__":
    audit_dependencies(Path(__file__).resolve().parents[1])
