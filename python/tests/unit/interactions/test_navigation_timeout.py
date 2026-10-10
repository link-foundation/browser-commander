from unittest.mock import AsyncMock, Mock

import pytest

from browser_commander.interactions.click import click_button


@pytest.mark.parametrize("change", ["url", "session", "none"])
async def test_element_timeout_after_navigation(monkeypatch, change):
    page = Mock(url="https://example.com/form")
    manager = Mock()
    manager.get_session_id.return_value = 1
    error = TimeoutError("waiting for submit")

    async def wait_for_element(**kwargs):
        if change == "url":
            page.url = "https://example.com/done"
        if change == "session":
            manager.get_session_id.return_value = 2
        raise error

    monkeypatch.setattr(
        "browser_commander.interactions.click.wait_for_locator_or_element",
        wait_for_element,
    )
    operation = click_button(
        page,
        "playwright",
        AsyncMock(),
        Mock(),
        "#submit",
        navigation_manager=manager,
    )
    if change == "none":
        with pytest.raises(TimeoutError):
            await operation
    else:
        result = await operation
        assert result.status == "interrupted"
        assert result.navigated is True
        assert result.dispatched is False
