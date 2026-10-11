"""Persistent selection ranks URLs ahead of an implicit remembered target."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

from browser_commander.browser import persistent_session


async def test_ranked_urls_override_a_live_remembered_target(monkeypatch):
    context = SimpleNamespace()
    pages = [
        SimpleNamespace(
            context=context,
            target_id=name,
            url=f"https://{name}.test",
            evaluate=AsyncMock(return_value="visible"),
        )
        for name in ("remembered", "preferred")
    ]
    context.pages = pages

    async def new_session(page):
        return SimpleNamespace(
            send=AsyncMock(return_value={"targetInfo": {"targetId": page.target_id}}),
            detach=AsyncMock(),
        )

    context.new_cdp_session = new_session
    monkeypatch.setattr(persistent_session, "_worker", AsyncMock())
    connection = SimpleNamespace(
        browser=SimpleNamespace(close=AsyncMock()), page=pages[0], downloads=None
    )
    session = persistent_session.PersistentSession(
        connection,
        {
            "userDataDir": "/tmp/dedicated-profile",
            "remoteDebuggingPort": 9222,
            "cdpEndpoint": "http://127.0.0.1:9222",
            "reused": True,
            "targetId": "remembered",
        },
    )
    try:
        selected = await session.reuse_page(
            url_matchers=["https://preferred.test", "https://remembered.test"]
        )
        assert selected is pages[1]
    finally:
        await session.detach()
