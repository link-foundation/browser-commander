"""Unit tests for writing a download into the managed directory (issue #88)."""

from __future__ import annotations

import hashlib
import os
import stat
from pathlib import Path
from typing import Any

import pytest

from browser_commander.downloads.destination import ARTIFACT_FILE_MODE
from browser_commander.downloads.store import (
    DownloadConflict,
    DownloadSource,
    clean_partials,
    resolve_final_path,
    save_download,
)


def staged(tmp_path: Path, body: bytes | str, name: str = "staged") -> DownloadSource:
    """Stage a download's bytes the way an engine does.

    Args:
        tmp_path: Directory to stage in
        body: File contents
        name: Staged file name

    Returns:
        A source pointing at the staged bytes
    """
    data = body.encode("utf-8") if isinstance(body, str) else body
    tmp_path.mkdir(parents=True, exist_ok=True)
    path = tmp_path / name
    path.write_bytes(data)
    return DownloadSource(path=str(path))


def listing(root: Path) -> list[str]:
    """List the names in a directory.

    Args:
        root: Directory to list

    Returns:
        Sorted entry names
    """
    return sorted(entry.name for entry in root.iterdir())


class TestSaveDownload:
    """A file under its final name is complete and has passed validation."""

    async def test_writes_the_bytes_and_reports_them(self, tmp_path: Path) -> None:
        root = tmp_path / "downloads"

        saved = await save_download(
            root=str(root),
            source=staged(tmp_path, "report body"),
            suggested_filename="report.pdf",
        )

        assert saved.path == str(root / "report.pdf")
        assert saved.bytes == 11
        assert saved.checksum == hashlib.sha256(b"report body").hexdigest()
        assert Path(saved.path).read_text(encoding="utf-8") == "report body"

    async def test_saves_bytes_handed_over_directly(self, tmp_path: Path) -> None:
        saved = await save_download(
            root=str(tmp_path),
            source=DownloadSource(data=b"in memory"),
            suggested_filename="memo.txt",
        )

        assert Path(saved.path).read_bytes() == b"in memory"

    @pytest.mark.skipif(os.name == "nt", reason="POSIX file modes")
    async def test_saves_the_file_for_its_owner_only(self, tmp_path: Path) -> None:
        saved = await save_download(
            root=str(tmp_path),
            source=staged(tmp_path, "private"),
            suggested_filename="report.pdf",
        )

        assert stat.S_IMODE(Path(saved.path).stat().st_mode) == ARTIFACT_FILE_MODE

    async def test_refuses_to_write_outside_the_root(self, tmp_path: Path) -> None:
        root = tmp_path / "downloads"
        root.mkdir()

        saved = await save_download(
            root=str(root),
            source=staged(tmp_path, "escaped"),
            suggested_filename="../../escaped.txt",
        )

        assert saved.path == str(root / "escaped.txt")

    async def test_names_a_bare_uuid_from_its_bytes(self, tmp_path: Path) -> None:
        # The case issue #88 names: a UUID filename with PDF content.
        saved = await save_download(
            root=str(tmp_path),
            source=staged(tmp_path, "%PDF-1.7 invoice"),
            suggested_filename="8d0f9e2c-4a11-4b22-9f00-1d2e3f405162",
        )

        assert Path(saved.path).name.endswith(".pdf")

    async def test_lets_the_caller_choose_the_name(self, tmp_path: Path) -> None:
        saved = await save_download(
            root=str(tmp_path),
            source=staged(tmp_path, "%PDF-1.7 invoice"),
            suggested_filename="8d0f9e2c-4a11-4b22-9f00-1d2e3f405162",
            filename=lambda **_kwargs: "invoice.pdf",
        )

        assert Path(saved.path).name == "invoice.pdf"

    async def test_sanitizes_the_name_the_caller_chose(self, tmp_path: Path) -> None:
        # A naming callback is a preference, not a grant of write access.
        root = tmp_path / "downloads"

        saved = await save_download(
            root=str(root),
            source=staged(tmp_path, "body"),
            suggested_filename="report.pdf",
            filename=lambda **_kwargs: "../escaped.pdf",
        )

        assert saved.path == str(root / "escaped.pdf")

    async def test_awaits_an_async_naming_callback(self, tmp_path: Path) -> None:
        async def name(**_kwargs: Any) -> str:
            return "async.pdf"

        saved = await save_download(
            root=str(tmp_path),
            source=staged(tmp_path, "body"),
            suggested_filename="report.pdf",
            filename=name,
        )

        assert Path(saved.path).name == "async.pdf"


class TestConflicts:
    """Two downloads that suggest one name must not become one file."""

    async def test_renames_rather_than_replacing(self, tmp_path: Path) -> None:
        for body in ("first", "second"):
            await save_download(
                root=str(tmp_path),
                source=staged(tmp_path / "staging", body, name=body),
                suggested_filename="report.pdf",
            )

        assert "report.pdf" in listing(tmp_path)
        assert "report (2).pdf" in listing(tmp_path)
        assert (tmp_path / "report.pdf").read_text(encoding="utf-8") == "first"

    async def test_overwrites_when_the_caller_asked_for_it(
        self, tmp_path: Path
    ) -> None:
        for body in ("first", "second"):
            await save_download(
                root=str(tmp_path),
                source=staged(tmp_path / "staging", body, name=body),
                suggested_filename="report.pdf",
                conflict=DownloadConflict.OVERWRITE,
            )

        assert (tmp_path / "report.pdf").read_text(encoding="utf-8") == "second"

    async def test_refuses_when_the_caller_asked_for_an_error(
        self, tmp_path: Path
    ) -> None:
        await save_download(
            root=str(tmp_path),
            source=staged(tmp_path / "staging", "first", name="first"),
            suggested_filename="report.pdf",
            conflict=DownloadConflict.ERROR,
        )

        with pytest.raises(FileExistsError, match="refusing to replace"):
            await save_download(
                root=str(tmp_path),
                source=staged(tmp_path / "staging", "second", name="second"),
                suggested_filename="report.pdf",
                conflict=DownloadConflict.ERROR,
            )

        assert not any(name.endswith(".partial") for name in listing(tmp_path))

    def test_resolve_final_path_counts_up_from_the_taken_name(
        self, tmp_path: Path
    ) -> None:
        (tmp_path / "report.pdf").write_text("taken", encoding="utf-8")

        resolved = resolve_final_path(
            root=str(tmp_path), name="report.pdf", conflict=DownloadConflict.RENAME
        )

        assert resolved == str(tmp_path / "report (2).pdf")


class TestValidation:
    """A rejected download never exists under a name a caller would use."""

    async def test_a_raising_validator_leaves_nothing_behind(
        self, tmp_path: Path
    ) -> None:
        def validate(**kwargs: Any) -> None:
            if kwargs["bytes"] < 1000:
                msg = "expected a PDF, got a login page"
                raise ValueError(msg)

        with pytest.raises(ValueError, match="expected a PDF"):
            await save_download(
                root=str(tmp_path),
                source=staged(tmp_path / "staging", "<html>login</html>"),
                suggested_filename="report.pdf",
                validate=validate,
            )

        assert listing(tmp_path) == ["staging"]

    async def test_a_validator_that_says_no_rejects_the_download(
        self, tmp_path: Path
    ) -> None:
        with pytest.raises(ValueError, match="rejected by the caller"):
            await save_download(
                root=str(tmp_path),
                source=staged(tmp_path / "staging", "<html>login</html>"),
                suggested_filename="report.pdf",
                validate=lambda **kwargs: kwargs["mime_type"] == "application/pdf",
            )

        assert listing(tmp_path) == ["staging"]

    async def test_a_validator_sees_the_file_before_it_is_published(
        self, tmp_path: Path
    ) -> None:
        seen: dict[str, Any] = {}

        def validate(**kwargs: Any) -> bool:
            seen.update(kwargs)
            # The bytes are readable, but not yet under the final name.
            assert Path(kwargs["path"]).read_bytes() == b"report body"
            assert Path(kwargs["path"]).name.endswith(".partial")
            return True

        await save_download(
            root=str(tmp_path),
            source=staged(tmp_path / "staging", "report body"),
            suggested_filename="report.pdf",
            mime_type="application/pdf",
            validate=validate,
        )

        assert seen["bytes"] == 11
        assert seen["suggested_filename"] == "report.pdf"
        assert seen["checksum"] == hashlib.sha256(b"report body").hexdigest()


class TestPartialCleanup:
    """A transfer that never finished leaves no half file around."""

    async def test_a_missing_source_leaves_no_partial_file(
        self, tmp_path: Path
    ) -> None:
        with pytest.raises(OSError, match="No such file"):
            await save_download(
                root=str(tmp_path),
                source=DownloadSource(path=str(tmp_path / "never-written")),
                suggested_filename="report.pdf",
            )

        assert listing(tmp_path) == []

    async def test_a_source_with_neither_bytes_nor_a_path_is_refused(
        self, tmp_path: Path
    ) -> None:
        with pytest.raises(TypeError, match="either data or a path"):
            await save_download(
                root=str(tmp_path),
                source=DownloadSource(),
                suggested_filename="report.pdf",
            )

        assert listing(tmp_path) == []

    def test_clean_partials_removes_only_partial_files(self, tmp_path: Path) -> None:
        (tmp_path / "report.pdf").write_text("kept", encoding="utf-8")
        (tmp_path / "report.pdf.123.456.partial").write_text("half", encoding="utf-8")

        removed = clean_partials(tmp_path)

        assert removed == [str(tmp_path / "report.pdf.123.456.partial")]
        assert listing(tmp_path) == ["report.pdf"]

    def test_clean_partials_accepts_a_directory_that_is_not_there(
        self, tmp_path: Path
    ) -> None:
        assert clean_partials(tmp_path / "missing") == []
