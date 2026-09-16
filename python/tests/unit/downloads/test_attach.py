"""Unit tests for wiring downloads into every entry point (issue #88)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from browser_commander.browser.connector import (
    ConnectOptions,
    connect_browser_with_dependencies,
)
from browser_commander.downloads.attach import (
    attach_downloads,
    normalize_download_options,
)
from browser_commander.factory import make_browser_commander
from tests.helpers.download_fixtures import FakeContext, FakeDownload, FakePage


class FakeConnectedBrowser:
    """A Playwright browser handed back by ``connect_over_cdp``."""

    def __init__(self, context: FakeContext) -> None:
        """Bind the browser to its default context.

        Args:
            context: The default context
        """
        self.contexts = [context]


def fake_playwright(browser: FakeConnectedBrowser) -> Any:
    """Build a ``start_playwright`` dependency returning one browser.

    Args:
        browser: The browser to connect to

    Returns:
        A callable matching the connector's dependency
    """

    class Chromium:
        async def connect_over_cdp(self, endpoint: str, **kwargs: Any) -> Any:
            del endpoint, kwargs
            return browser

    class Playwright:
        chromium = Chromium()

    async def start() -> Any:
        return Playwright()

    return start


def context_with_page() -> tuple[FakeContext, FakePage]:
    """Build a context that already has a page, as a connection does.

    Returns:
        The context and its page
    """
    context = FakeContext()
    page = FakePage(context)
    context.pages = [page]  # type: ignore[attr-defined]
    return context, page


class TestNormalizeDownloadOptions:
    """The ``downloads`` option says whether there is a manager at all."""

    @pytest.mark.parametrize("value", [None, False])
    def test_an_absent_or_disabled_option_means_no_manager(self, value: object) -> None:
        assert normalize_download_options(value) is None  # type: ignore[arg-type]

    def test_true_means_manage_downloads_with_the_defaults(self) -> None:
        assert normalize_download_options(True) == {}

    def test_a_mapping_is_passed_through_as_manager_options(self) -> None:
        options = {"directory": "/tmp/x", "conflict": "overwrite"}

        assert normalize_download_options(options) == options

    def test_refuses_a_value_that_cannot_describe_the_option(self) -> None:
        with pytest.raises(TypeError, match="True, False or a mapping"):
            normalize_download_options("/tmp/downloads")  # type: ignore[arg-type]


class TestAttachDownloads:
    """One function builds the manager, however the browser was obtained."""

    async def test_attaches_nothing_when_downloads_were_not_requested(
        self,
    ) -> None:
        assert (
            await attach_downloads(engine="playwright", browser=FakeContext()) is None
        )

    async def test_manages_downloads_from_the_context_it_attached_to(
        self, tmp_path: Path
    ) -> None:
        context = FakeContext()
        manager = await attach_downloads(
            engine="playwright",
            browser=context,
            downloads={"directory": str(tmp_path / "downloads")},
        )
        assert manager is not None

        await context.emit_download(
            FakeDownload(directory=str(tmp_path), suggested_filename="a.txt")
        )
        await manager.idle()

        assert [Path(a.path).name for a in manager.list()] == ["a.txt"]
        await manager.dispose()


class TestConnectedBrowsers:
    """An attached browser gets the same lifecycle as a launched one."""

    async def test_a_connection_returns_a_manager(self, tmp_path: Path) -> None:
        # Issue #88 asks for one manager identical across launch_browser(),
        # connect_browser() and launch_real_browser(), so the connector must
        # return the same handle rather than leaving attached browsers
        # unmanaged.
        context, _page = context_with_page()
        root = tmp_path / "downloads"

        connection = await connect_browser_with_dependencies(
            ConnectOptions(
                engine="playwright",
                cdp_endpoint="http://127.0.0.1:9222",
                downloads={"directory": str(root)},
            ),
            start_playwright=fake_playwright(FakeConnectedBrowser(context)),
        )

        assert connection.downloads is not None
        assert connection.downloads.directory == str(root)

        await context.emit_download(
            FakeDownload(
                directory=str(tmp_path),
                suggested_filename="attached.txt",
                body="hello",
            )
        )
        await connection.downloads.idle()

        assert (root / "attached.txt").read_text(encoding="utf-8") == "hello"
        await connection.downloads.dispose()

    async def test_a_connection_is_unmanaged_when_downloads_are_not_asked_for(
        self,
    ) -> None:
        context, _page = context_with_page()

        connection = await connect_browser_with_dependencies(
            ConnectOptions(engine="playwright", cdp_endpoint="http://127.0.0.1:9222"),
            start_playwright=fake_playwright(FakeConnectedBrowser(context)),
        )

        assert connection.downloads is None


class TestCommanderDownloads:
    """A commander can be given a manager, or grow one later."""

    @staticmethod
    def commander_over(context: FakeContext, downloads: Any = None) -> Any:
        """Build a commander over a fake context.

        Args:
            context: The context its page belongs to
            downloads: A manager to expose as ``commander.downloads``

        Returns:
            A browser commander
        """
        return make_browser_commander(
            page=FakePage(context),
            enable_network_tracking=False,
            enable_navigation_manager=False,
            enable_dialog_manager=False,
            downloads=downloads,
        )

    def test_exposes_a_manager_the_caller_already_has(self) -> None:
        manager = object()

        commander = self.commander_over(FakeContext(), manager)

        assert commander.downloads is manager

    async def test_attaches_a_manager_to_a_commander_built_without_one(
        self, tmp_path: Path
    ) -> None:
        context = FakeContext()
        commander = self.commander_over(context)
        assert commander.downloads is None

        manager = await commander.configure_downloads(
            {"directory": str(tmp_path / "downloads")}
        )

        assert commander.downloads is manager
        await context.emit_download(
            FakeDownload(directory=str(tmp_path), suggested_filename="configured.txt")
        )
        await manager.idle()

        assert Path(manager.list()[0].path).name == "configured.txt"
        await manager.dispose()

    async def test_keeps_downloaded_files_when_the_commander_is_destroyed(
        self, tmp_path: Path
    ) -> None:
        # Persistence is the point: destroying the commander stops observation,
        # it does not take the user's file away.
        context = FakeContext()
        root = tmp_path / "downloads"
        commander = self.commander_over(context)
        await commander.configure_downloads({"directory": str(root)})

        await context.emit_download(
            FakeDownload(
                directory=str(tmp_path), suggested_filename="kept.txt", body="hello"
            )
        )
        await commander.destroy()

        assert (root / "kept.txt").read_text(encoding="utf-8") == "hello"

    async def test_replacing_a_manager_detaches_the_old_one(
        self, tmp_path: Path
    ) -> None:
        # Two sources writing into one directory would report every download
        # twice.
        context = FakeContext()
        commander = self.commander_over(context)
        await commander.configure_downloads({"directory": str(tmp_path / "first")})
        await commander.configure_downloads({"directory": str(tmp_path / "second")})

        assert context.listener_count("download") == 1
        await commander.destroy()
