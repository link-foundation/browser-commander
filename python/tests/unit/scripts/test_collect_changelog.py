"""Tests for scripts/collect_changelog.py."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))

from collect_changelog import collect, list_fragment_files

SCRIV_CONFIG = """\
[project]
name = "fixture"
version = "0.5.3"

[tool.scriv]
format = "md"
md_header_level = "2"
fragment_directory = "changelog.d"
insert_marker = "<!-- scriv-insert-here -->"
main_branches = ["main"]
version = "literal: pyproject.toml: project.version"
"""


@pytest.fixture
def project(tmp_path: Path) -> Path:
    """A minimal project with one changelog fragment."""
    (tmp_path / "pyproject.toml").write_text(SCRIV_CONFIG)
    fragments = tmp_path / "changelog.d"
    (fragments / "templates").mkdir(parents=True)
    (fragments / "templates" / "new_fragment.md.j2").write_text("")
    (fragments / "README.md").write_text("Fragments live here.")
    (fragments / "12.fixed.md").write_text("### Fixed\n\n- Something.\n")
    (tmp_path / "CHANGELOG.md").write_text(
        "# Changelog\n\n<!-- scriv-insert-here -->\n"
    )
    return tmp_path


def test_list_fragment_files_ignores_readme_and_templates(project: Path) -> None:
    """Only real fragments count: not README.md, not the Jinja templates."""
    assert [path.name for path in list_fragment_files(project)] == ["12.fixed.md"]


def test_list_fragment_files_without_directory(tmp_path: Path) -> None:
    """A missing changelog.d is not an error."""
    assert list_fragment_files(tmp_path) == []


def test_collect_is_a_noop_without_fragments(tmp_path: Path) -> None:
    """Nothing to collect means no scriv invocation and no failure."""
    (tmp_path / "changelog.d").mkdir()
    assert collect("1.2.3", tmp_path) is False


@pytest.mark.skipif(
    subprocess.run(["which", "scriv"], capture_output=True).returncode != 0,
    reason="scriv is not installed",
)
def test_collect_heads_the_section_with_the_version(project: Path) -> None:
    """Regression: the workflow used to pass the bump type as --version.

    `scriv collect --version` names the new changelog section, so passing
    "patch" wrote a section titled "patch" instead of the released version.
    """
    assert collect("0.5.4", project) is True

    changelog = (project / "CHANGELOG.md").read_text()
    assert "## 0.5.4" in changelog
    assert "\n## patch" not in changelog
    assert "- Something." in changelog

    # The fragment is consumed so the next release cannot re-ship it, while
    # README.md and the templates survive.
    assert not (project / "changelog.d" / "12.fixed.md").exists()
    assert (project / "changelog.d" / "README.md").exists()


@pytest.mark.skipif(
    subprocess.run(["which", "scriv"], capture_output=True).returncode != 0,
    reason="scriv is not installed",
)
def test_collected_section_is_readable_by_the_release_script(project: Path) -> None:
    """md_header_level 2 is what create_github_release.py parses."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
    from create_github_release import extract_changelog_entry

    collect("0.5.4", project)

    notes = extract_changelog_entry(project / "CHANGELOG.md", "0.5.4")
    assert "- Something." in notes
    assert notes != "Release 0.5.4"
