"""Regression tests for the table-aware manifest reader.

The Python release job failed on every run since `[tool.scriv] version` was
added to pyproject.toml, because the workflow scraped the version with a
line-anchored but table-blind grep and wrote two lines into $GITHUB_OUTPUT.
The write path had the mirror image of the same defect: an unscoped `re.sub`
overwrote the scriv literal with a version number.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parents[3] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from read_manifest import (  # noqa: E402
    read_field,
    read_manifest_field,
    replace_field,
    strip_comment,
)
from version_and_commit import (  # noqa: E402
    get_current_version,
    update_version_in_file,
)

PYPROJECT = SCRIPTS_DIR.parent / "pyproject.toml"
CARGO = SCRIPTS_DIR.parents[1] / "rust" / "Cargo.toml"


def legacy_grep_versions(content: str) -> list:
    """What the workflow's `grep -Po '(?<=^version = ")[^"]*'` matched."""
    return re.findall(r'^version = "([^"]*)"', content, flags=re.MULTILINE)


def test_reproduces_the_multi_match_that_broke_the_release():
    matches = legacy_grep_versions(PYPROJECT.read_text())
    assert len(matches) > 1
    assert "literal: pyproject.toml: project.version" in matches


def test_reads_the_project_version_despite_the_scriv_literal():
    assert read_manifest_field(PYPROJECT) == read_field(
        PYPROJECT.read_text(), "project", "version"
    )
    assert re.match(r"^\d+\.\d+\.\d+", read_manifest_field(PYPROJECT))


def test_reads_the_crate_version_and_name_past_bin_and_lib():
    assert re.match(r"^\d+\.\d+\.\d+", read_manifest_field(CARGO))
    assert read_manifest_field(CARGO, field="name") == "browser-commander"


def test_ignores_a_version_declared_in_an_earlier_table():
    toml = (
        '[tool.scriv]\nversion = "literal: pyproject.toml: project.version"\n'
        '\n[project]\nversion = "1.2.3"\n'
    )
    assert read_field(toml, "project", "version") == "1.2.3"


def test_strip_comment_keeps_a_hash_inside_a_value():
    assert strip_comment('version = "1.0.0" # released') == 'version = "1.0.0"'
    assert strip_comment('name = "colors #fff"') == 'name = "colors #fff"'


def test_missing_field_fails_loudly(tmp_path: Path):
    manifest = tmp_path / "pyproject.toml"
    manifest.write_text('[tool.scriv]\nversion = "literal: x"\n')
    with pytest.raises(ValueError, match=r'no non-empty "version" in \[project\]'):
        read_manifest_field(manifest)


def test_empty_version_fails_loudly(tmp_path: Path):
    manifest = tmp_path / "pyproject.toml"
    manifest.write_text('[project]\nversion = ""\n')
    with pytest.raises(ValueError, match=r'no non-empty "version"'):
        read_manifest_field(manifest)


def test_replace_field_leaves_the_scriv_literal_untouched(tmp_path: Path):
    manifest = tmp_path / "pyproject.toml"
    manifest.write_text(PYPROJECT.read_text())

    update_version_in_file(manifest, "9.9.9")
    updated = manifest.read_text()

    assert read_field(updated, "project", "version") == "9.9.9"
    assert (
        read_field(updated, "tool.scriv", "version")
        == "literal: pyproject.toml: project.version"
    )
    assert get_current_version(manifest) == "9.9.9"


def test_replace_field_rejects_a_missing_key():
    with pytest.raises(ValueError, match="No \\[project\\] version to update"):
        replace_field('[tool.scriv]\nversion = "x"\n', "project", "version", "1.0.0")


def test_replace_field_keeps_spacing_and_a_trailing_comment():
    content = '[project]\n  version   =   "1.2.3"  # keep "this"\n'

    assert replace_field(content, "project", "version", "9.9.9") == (
        '[project]\n  version   =   "9.9.9"  # keep "this"\n'
    )


def test_replace_field_refuses_a_version_it_cannot_rewrite():
    # Returning the file unchanged here would publish the old version. The
    # JavaScript reader raises on the same input; see
    # js/tests/unit/scripts/read-manifest.test.js.
    with pytest.raises(ValueError, match="is not a quoted string"):
        replace_field("[project]\nversion = 3\n", "project", "version", "9.9.9")


def test_cli_prints_the_project_version():
    result = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / "read_manifest.py"), str(PYPROJECT)],
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.strip() == read_manifest_field(PYPROJECT)


def test_cli_writes_the_github_output_file(tmp_path: Path, monkeypatch):
    output_file = tmp_path / "github_output"
    output_file.touch()
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_file))

    import read_manifest

    assert read_manifest.main([str(PYPROJECT), "--output", "current_version"]) == 0
    lines = output_file.read_text().splitlines()
    assert lines == [f"current_version={read_manifest_field(PYPROJECT)}"]


def test_cli_fails_on_a_manifest_without_the_field(tmp_path: Path):
    manifest = tmp_path / "pyproject.toml"
    manifest.write_text('[tool.scriv]\nformat = "md"\n')
    result = subprocess.run(
        [sys.executable, str(SCRIPTS_DIR / "read_manifest.py"), str(manifest)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 1
    assert "::error::" in result.stderr
