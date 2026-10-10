from types import SimpleNamespace

import pytest

from browser_commander.elements.locators import wait_for_locator_or_element
from browser_commander.elements.selectors import wait_for_selector


@pytest.mark.parametrize("wait", [wait_for_locator_or_element, wait_for_selector])
async def test_timeout_after_navigation_is_interrupted(wait):
    page = SimpleNamespace(url="https://example.test/form")

    async def wait_for(**_kwargs):
        page.url = "https://example.test/sent"
        raise TimeoutError("timeout")

    locator = SimpleNamespace(wait_for=wait_for)
    locator.first = locator
    page.locator = lambda _selector: locator
    result = await wait(page, "playwright", "button", throw_on_navigation=False)
    assert result is None or result is False
