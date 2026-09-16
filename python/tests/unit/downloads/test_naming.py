"""Unit tests for download naming and path safety (issue #88)."""

from __future__ import annotations

from pathlib import Path

import pytest

from browser_commander.downloads.naming import (
    FALLBACK_NAME,
    declared_extension,
    extension_from_content,
    is_inside_root,
    renamed_candidate,
    resolve_inside_root,
    sanitize_download_name,
    with_extension,
)


class TestSanitizeDownloadName:
    """A page's suggested name is a suggestion, never a path."""

    def test_keeps_an_ordinary_name(self) -> None:
        assert sanitize_download_name("report.pdf") == "report.pdf"

    @pytest.mark.parametrize(
        "suggested",
        ["../../etc/passwd", "/etc/passwd", "..\\..\\windows\\system32\\passwd"],
    )
    def test_drops_every_path_segment(self, suggested: str) -> None:
        assert sanitize_download_name(suggested) == "passwd"

    def test_replaces_characters_a_filesystem_refuses(self) -> None:
        assert sanitize_download_name('in:va*lid?"name.txt') == "in_va_lid__name.txt"

    def test_removes_control_characters(self) -> None:
        assert sanitize_download_name("re\x00port\x1f.pdf") == "report.pdf"

    @pytest.mark.parametrize("suggested", ["", "   ", "...", None, 42])
    def test_falls_back_when_nothing_usable_is_left(self, suggested: object) -> None:
        assert sanitize_download_name(suggested) == FALLBACK_NAME

    def test_strips_trailing_dots_and_spaces(self) -> None:
        assert sanitize_download_name(" report.pdf . ") == "report.pdf"

    @pytest.mark.parametrize("reserved", ["CON", "nul.txt", "com1.log", "LPT9"])
    def test_escapes_names_windows_reserves_for_devices(self, reserved: str) -> None:
        assert sanitize_download_name(reserved) == f"_{reserved}"

    def test_keeps_a_leading_dot_file(self) -> None:
        assert sanitize_download_name(".env") == ".env"


class TestDeclaredExtension:
    """The extension rule both languages share."""

    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("report.pdf", ".pdf"),
            ("archive.tar.gz", ".gz"),
            ("report", ""),
            (".env", ""),
        ],
    )
    def test_reads_the_trailing_extension(self, name: str, expected: str) -> None:
        assert declared_extension(name) == expected


class TestExtensionFromContent:
    """Bytes name a file when nothing else does."""

    @pytest.mark.parametrize(
        ("head", "expected"),
        [
            (b"%PDF-1.7", ".pdf"),
            (b"PK\x03\x04rest", ".zip"),
            (b"\x89PNG\r\n\x1a\n", ".png"),
            (b"plain text", ""),
            (b"", ""),
            (None, ""),
        ],
    )
    def test_sniffs_known_formats(self, head: bytes | None, expected: str) -> None:
        assert extension_from_content(head) == expected


class TestWithExtension:
    """A UUID-named download is unusable without a suffix."""

    def test_leaves_a_named_file_alone(self) -> None:
        assert with_extension("report.pdf", mime_type="text/plain") == "report.pdf"

    def test_takes_the_extension_from_the_declared_type(self) -> None:
        assert with_extension("8d0f9e2c", mime_type="application/pdf") == "8d0f9e2c.pdf"

    def test_ignores_charset_parameters_on_the_type(self) -> None:
        name = with_extension("note", mime_type="text/plain; charset=utf-8")
        assert name == "note.txt"

    def test_falls_back_to_the_bytes_when_the_type_says_nothing(self) -> None:
        name = with_extension(
            "8d0f9e2c", mime_type="application/octet-stream", head=b"%PDF-1.7"
        )
        assert name == "8d0f9e2c.pdf"

    def test_still_names_a_truly_unidentifiable_binary_download(self) -> None:
        name = with_extension(
            "payload", mime_type="application/octet-stream", head=b"\x01\x02"
        )
        assert name == "payload.bin"

    def test_leaves_a_file_nothing_identifies_unchanged(self) -> None:
        assert with_extension("mystery", head=b"who knows") == "mystery"


class TestRootContainment:
    """Nothing a page suggests may write outside the download directory."""

    def test_accepts_a_file_inside_the_root(self, tmp_path: Path) -> None:
        assert is_inside_root(tmp_path, tmp_path / "report.pdf") is True

    def test_rejects_the_root_itself(self, tmp_path: Path) -> None:
        assert is_inside_root(tmp_path, tmp_path) is False

    def test_rejects_an_escape(self, tmp_path: Path) -> None:
        assert is_inside_root(tmp_path, tmp_path.parent / "passwd") is False

    def test_resolves_a_safe_name(self, tmp_path: Path) -> None:
        resolved = resolve_inside_root(str(tmp_path), "report.pdf")
        assert resolved == str(tmp_path / "report.pdf")

    def test_refuses_a_name_that_escapes_the_root(self, tmp_path: Path) -> None:
        with pytest.raises(ValueError, match="outside"):
            resolve_inside_root(str(tmp_path), "../passwd")


class TestRenamedCandidate:
    """Collisions resolve the same way on every run."""

    def test_first_attempt_is_the_name_itself(self) -> None:
        assert renamed_candidate("report.pdf", 0) == "report.pdf"

    def test_later_attempts_count_up_before_the_extension(self) -> None:
        assert renamed_candidate("report.pdf", 1) == "report (2).pdf"
        assert renamed_candidate("report.pdf", 2) == "report (3).pdf"

    def test_a_file_without_an_extension_keeps_its_shape(self) -> None:
        assert renamed_candidate("report", 1) == "report (2)"
