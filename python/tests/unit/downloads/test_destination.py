"""Unit tests for resolving and preparing the download directory (issue #88)."""

from __future__ import annotations

import os
import stat
import tempfile
from pathlib import Path

import pytest

from browser_commander.downloads.destination import (
    ARTIFACT_DIRECTORY_MODE,
    DownloadDirectoryPreset,
    prepare_download_directory,
    resolve_download_directory,
)


class TestResolveDownloadDirectory:
    """A setting becomes an absolute path before any download starts."""

    def test_temporary_preset_lives_under_the_system_temporary_directory(self) -> None:
        resolved = resolve_download_directory(DownloadDirectoryPreset.TEMPORARY)

        assert resolved == str(
            Path(tempfile.gettempdir(), "browser-commander-downloads")
        )

    def test_defaults_to_the_user_downloads_folder(self) -> None:
        assert resolve_download_directory() == resolve_download_directory(
            DownloadDirectoryPreset.USER_DOWNLOADS
        )

    @pytest.mark.skipif(
        os.name == "nt", reason="XDG user directories are a Linux convention"
    )
    def test_reads_a_relocated_downloads_folder_from_xdg(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # A localized or moved Downloads folder is the user's real folder; an
        # English path that happens to exist is not.
        monkeypatch.setattr("sys.platform", "linux")
        monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
        Path(tmp_path, "user-dirs.dirs").write_text(
            f'XDG_DOWNLOAD_DIR="{tmp_path}/Téléchargements"\n', encoding="utf-8"
        )

        resolved = resolve_download_directory(DownloadDirectoryPreset.USER_DOWNLOADS)

        assert resolved == f"{tmp_path}/Téléchargements"

    def test_accepts_an_absolute_path(self, tmp_path: Path) -> None:
        assert resolve_download_directory(tmp_path) == str(tmp_path.resolve())

    def test_refuses_a_relative_path(self) -> None:
        with pytest.raises(ValueError, match="must be absolute"):
            resolve_download_directory("downloads")

    @pytest.mark.parametrize("directory", [42, b"/tmp", ""])
    def test_refuses_a_value_that_cannot_describe_a_directory(
        self, directory: object
    ) -> None:
        with pytest.raises(TypeError, match="absolute path"):
            resolve_download_directory(directory)  # type: ignore[arg-type]


class TestPrepareDownloadDirectory:
    """A directory that exists is not the same as one we may write in."""

    def test_creates_the_directory_for_its_owner_only(self, tmp_path: Path) -> None:
        root = tmp_path / "nested" / "downloads"

        prepared = prepare_download_directory(root)

        assert prepared == str(root)
        assert root.is_dir()
        if os.name != "nt":
            mode = stat.S_IMODE(root.stat().st_mode)
            assert mode == ARTIFACT_DIRECTORY_MODE

    def test_leaves_no_probe_file_behind(self, tmp_path: Path) -> None:
        prepare_download_directory(tmp_path)

        assert list(tmp_path.iterdir()) == []

    def test_accepts_a_directory_that_already_exists(self, tmp_path: Path) -> None:
        prepare_download_directory(tmp_path)

        assert prepare_download_directory(tmp_path) == str(tmp_path)

    @pytest.mark.skipif(
        os.name == "nt" or os.geteuid() == 0,
        reason="a read-only directory does not stop root",
    )
    def test_reports_a_directory_it_cannot_write_into(self, tmp_path: Path) -> None:
        # Found now, with the reason attached, rather than later as a download
        # that silently never arrived.
        read_only = tmp_path / "read-only"
        read_only.mkdir()
        read_only.chmod(0o500)

        try:
            with pytest.raises(OSError, match="not writable"):
                prepare_download_directory(read_only)
        finally:
            read_only.chmod(0o700)
