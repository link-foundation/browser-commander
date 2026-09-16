"""Managed, persistent downloads for every browser session (issue #88)."""

from __future__ import annotations

from browser_commander.downloads.attach import (
    attach_downloads,
    normalize_download_options,
)
from browser_commander.downloads.destination import (
    ARTIFACT_DIRECTORY_MODE,
    ARTIFACT_FILE_MODE,
    DownloadDirectoryPreset,
    prepare_download_directory,
    resolve_download_directory,
)
from browser_commander.downloads.manager import (
    DEFAULT_CAPTURE_TIMEOUT,
    DownloadArtifact,
    DownloadEvent,
    DownloadManager,
    create_download_manager,
    download_context,
)
from browser_commander.downloads.naming import (
    extension_from_content,
    is_inside_root,
    renamed_candidate,
    resolve_inside_root,
    sanitize_download_name,
    with_extension,
)
from browser_commander.downloads.sources import (
    DownloadFailure,
    classify_failure,
)
from browser_commander.downloads.staging import (
    DEFAULT_STAGING_POLL_INTERVAL,
    DEFAULT_STAGING_TIMEOUT,
    STAGING_IN_PROGRESS_SUFFIXES,
    StagedFile,
    describe_staging_timeout,
    wait_for_staged_file,
)
from browser_commander.downloads.store import (
    DownloadConflict,
    DownloadSource,
    SavedDownload,
    clean_partials,
    save_download,
)
from browser_commander.downloads.watcher import (
    DirectoryWatcher,
    attach_filesystem_watcher,
)

__all__ = [
    "ARTIFACT_DIRECTORY_MODE",
    "ARTIFACT_FILE_MODE",
    "DEFAULT_CAPTURE_TIMEOUT",
    "DEFAULT_STAGING_POLL_INTERVAL",
    "DEFAULT_STAGING_TIMEOUT",
    "STAGING_IN_PROGRESS_SUFFIXES",
    "DirectoryWatcher",
    "DownloadArtifact",
    "DownloadConflict",
    "DownloadDirectoryPreset",
    "DownloadEvent",
    "DownloadFailure",
    "DownloadManager",
    "DownloadSource",
    "SavedDownload",
    "StagedFile",
    "attach_downloads",
    "attach_filesystem_watcher",
    "classify_failure",
    "clean_partials",
    "create_download_manager",
    "describe_staging_timeout",
    "download_context",
    "extension_from_content",
    "is_inside_root",
    "normalize_download_options",
    "prepare_download_directory",
    "renamed_candidate",
    "resolve_download_directory",
    "resolve_inside_root",
    "sanitize_download_name",
    "save_download",
    "wait_for_staged_file",
    "with_extension",
]
