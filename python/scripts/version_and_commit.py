#!/usr/bin/env python3
"""
Version packages and commit to main branch.

This script handles version bumping and committing for CI/CD workflows.
It supports idempotent re-runs and detects when work was already completed.

Usage:
    python scripts/version_and_commit.py --bump-type <major|minor|patch> [--description "..."]

Example:
    python scripts/version_and_commit.py --bump-type patch
    python scripts/version_and_commit.py --bump-type minor --description "New feature"

Environment variables:
    GITHUB_OUTPUT: Path to GitHub Actions output file
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from collect_changelog import collect as collect_changelog
from git_push import push_with_rebase_retry
from read_manifest import read_field, replace_field


def run_command(
    cmd: list[str], check: bool = True, capture: bool = False
) -> subprocess.CompletedProcess:
    """Run a command and handle errors."""
    cmd_str = " ".join(cmd)
    print(f"Running: {cmd_str}")

    result = subprocess.run(
        cmd,
        capture_output=capture,
        text=True,
        check=False,
    )

    if not capture:
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr, file=sys.stderr)

    if check and result.returncode != 0:
        if capture:
            print(result.stdout)
            print(result.stderr, file=sys.stderr)
        print(
            f"Error: Command failed with exit code {result.returncode}",
            file=sys.stderr,
        )
        sys.exit(result.returncode)

    return result


def set_github_output(key: str, value: str) -> None:
    """Set GitHub Actions output variable."""
    output_file = os.environ.get("GITHUB_OUTPUT")
    if output_file:
        with Path(output_file).open("a") as f:
            f.write(f"{key}={value}\n")
        print(f"Set output: {key}={value}")


def get_current_version(pyproject_path: Path) -> str:
    """Get the [project] version from pyproject.toml.

    Scoped to the [project] table: [tool.scriv] also declares a `version` key,
    and a whole-file regex would read whichever one comes first.
    """
    version = read_field(pyproject_path.read_text(), "project", "version")
    if not version:
        raise ValueError("Could not find [project] version in pyproject.toml")
    return version


def bump_version(current: str, bump_type: str) -> str:
    """Bump the version according to semver."""
    parts = current.split(".")
    if len(parts) != 3:
        raise ValueError(f"Invalid version format: {current}")

    major, minor, patch = int(parts[0]), int(parts[1]), int(parts[2])

    if bump_type == "major":
        return f"{major + 1}.0.0"
    elif bump_type == "minor":
        return f"{major}.{minor + 1}.0"
    else:  # patch
        return f"{major}.{minor}.{patch + 1}"


def update_version_in_file(pyproject_path: Path, new_version: str) -> None:
    """Update the [project] version in pyproject.toml.

    Only that table is rewritten. An unscoped substitution also overwrites
    `[tool.scriv] version = "literal: pyproject.toml: project.version"`, which
    replaces the scriv directive with a frozen number.
    """
    content = pyproject_path.read_text()
    pyproject_path.write_text(replace_field(content, "project", "version", new_version))


def configure_git() -> None:
    """Configure git for automated commits."""
    print("Configuring git...")
    run_command(
        ["git", "config", "user.name", "github-actions[bot]"],
    )
    run_command(
        ["git", "config", "user.email", "github-actions[bot]@users.noreply.github.com"],
    )


def check_remote_changes(pyproject_path: Path) -> tuple[bool, str]:
    """
    Check if remote main has advanced (handles re-runs).
    Returns (already_released, remote_version).
    """
    print("\nChecking for remote changes...")
    run_command(["git", "fetch", "origin", "main"])

    # Get commit SHAs
    local_head = run_command(
        ["git", "rev-parse", "HEAD"],
        capture=True,
    ).stdout.strip()

    remote_head = run_command(
        ["git", "rev-parse", "origin/main"],
        capture=True,
    ).stdout.strip()

    if local_head != remote_head:
        print(f"Remote main has advanced (local: {local_head}, remote: {remote_head})")
        print("This may indicate a previous attempt partially succeeded.")

        # Get remote version - need to look in python/pyproject.toml
        try:
            remote_content = run_command(
                ["git", "show", "origin/main:python/pyproject.toml"],
                capture=True,
            ).stdout
        except Exception:
            # Fallback to local path
            remote_content = run_command(
                ["git", "show", f"origin/main:{pyproject_path}"],
                capture=True,
            ).stdout

        remote_version = read_field(remote_content, "project", "version")
        if remote_version:
            print(f"Remote version: {remote_version}")

            # Check if versions differ (indicating work was done)
            local_version = get_current_version(pyproject_path)
            if local_version != remote_version:
                print("Local and remote versions differ, rebasing...")
                run_command(["git", "rebase", "origin/main"])
                return False, remote_version
            else:
                print("Versions match, assuming previous run completed successfully")
                return True, remote_version

    return False, ""


def main() -> int:
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Version bump and commit for CI/CD",
    )
    parser.add_argument(
        "--bump-type",
        choices=["major", "minor", "patch"],
        required=True,
        help="Type of version bump",
    )
    parser.add_argument(
        "--description",
        default="",
        help="Description for changelog",
    )

    args = parser.parse_args()

    # Determine project root
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    pyproject_path = project_root / "pyproject.toml"

    if not pyproject_path.exists():
        print(f"Error: {pyproject_path} not found", file=sys.stderr)
        return 1

    try:
        # Configure git
        configure_git()

        # Check for remote changes
        already_released, remote_version = check_remote_changes(pyproject_path)

        if already_released:
            print("Version bump already completed in previous run")
            set_github_output("version_committed", "false")
            set_github_output("already_released", "true")
            set_github_output("new_version", remote_version)
            return 0

        # Get current version
        old_version = get_current_version(pyproject_path)
        print(f"\nCurrent version: {old_version}")

        # Bump version
        new_version = bump_version(old_version, args.bump_type)
        print(f"New version: {new_version}")

        # Update version in file
        update_version_in_file(pyproject_path, new_version)
        set_github_output("new_version", new_version)

        # Collect changelog fragments under the version being released. This
        # has to happen after the bump: `scriv collect --version` names the new
        # section, and the workflow used to run it beforehand with the bump
        # type, which titled the section "patch".
        collect_changelog(new_version, project_root)

        # Check for changes
        status = run_command(
            ["git", "status", "--porcelain"],
            capture=True,
        ).stdout.strip()

        if status:
            print("\nChanges detected, committing...")

            # Stage all changes
            run_command(["git", "add", "-A"])

            # Commit with version as message
            commit_msg = f"python: {new_version}"
            if args.description:
                commit_msg += f" - {args.description}"
            run_command(["git", "commit", "-m", commit_msg])

            # Push to main.
            #
            # check_remote_changes() rebases before the bump, so it cannot
            # cover a writer that lands between the bump and this push.
            # push_with_rebase_retry closes that window and, just as
            # importantly, tells a lost race apart from a branch-protection
            # rejection instead of retrying one as if it were the other.
            push_with_rebase_retry(branch="main")

            print(
                f"\n Version bump committed and pushed: {old_version} -> {new_version}"
            )
            set_github_output("version_committed", "true")
        else:
            print("\nNo changes to commit")
            set_github_output("version_committed", "false")

        return 0

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
