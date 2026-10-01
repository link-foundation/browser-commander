"""Regression tests for calling Python Playwright's API as it is shaped.

Python Playwright exposes ``Locator.first`` as a property, where JavaScript has
a ``first()`` method. Calling it raised ``TypeError: 'Locator' object is not
callable`` on a real browser, which the ``MagicMock`` fixtures elsewhere could
not catch: a mock is callable whatever it is. The fake here is shaped like the
real class, so calling ``first`` fails the same way.
"""

from __future__ import annotations

from typing import Any

from browser_commander.core.engine_adapter import PlaywrightAdapter
from browser_commander.elements.locators import wait_for_locator_or_element
from browser_commander.elements.selectors import query_selector
from browser_commander.elements.visibility import is_enabled
from browser_commander.interactions.fill import perform_fill


class FakeLocator:
    """A locator whose ``first`` is a property, as in Python Playwright."""

    def __init__(self, matches: int = 1, value: str = "") -> None:
        self.matches = matches
        self.value = value
        self.typed: list[str] = []
        self.waited_for: dict[str, Any] | None = None

    @property
    def first(self) -> FakeLocator:
        return self

    async def count(self) -> int:
        return self.matches

    async def wait_for(self, **options: Any) -> None:
        self.waited_for = options

    async def evaluate(self, _script: str, *_args: Any) -> bool:
        return False

    async def type(self, text: str) -> None:
        self.typed.append(text)
        self.value += text

    async def input_value(self) -> str:
        return self.value


class FakePage:
    def __init__(self, locator: FakeLocator) -> None:
        self._locator = locator

    def locator(self, _selector: str) -> FakeLocator:
        return self._locator


async def test_query_selector_reads_first_as_a_property():
    target = FakeLocator()

    found = await query_selector(FakePage(target), "playwright", "#go")

    assert found is target


async def test_wait_for_locator_or_element_reads_first_as_a_property():
    target = FakeLocator()

    found = await wait_for_locator_or_element(
        FakePage(target), "playwright", "#go", timeout=100
    )

    assert found is target
    assert target.waited_for == {"state": "visible", "timeout": 100}


async def test_is_enabled_reads_first_as_a_property():
    # Before the fix the TypeError was swallowed and an enabled element was
    # reported as disabled.
    assert await is_enabled(FakePage(FakeLocator()), "playwright", "#go") is True


async def test_simulated_typing_uses_the_adapter_type_text_method():
    target = FakeLocator()
    page = FakePage(target)

    result = await perform_fill(
        page=page,
        engine="playwright",
        locator_or_element=target,
        text="hi",
        simulate_typing=True,
        adapter=PlaywrightAdapter(page),
    )

    assert target.typed == ["hi"]
    assert result.filled is True
