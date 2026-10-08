"""Ordered selectors, normalized page text, and idempotent form controls."""

from typing import Any

from browser_commander.core.engine_adapter import create_engine_adapter
from browser_commander.elements.locators import get_locator_or_element
from browser_commander.elements.visibility import count, is_visible


async def find_first(
    page: Any, engine: Any, selectors: list[str], visible: bool = False
) -> str | None:
    """Return the first matching selector in caller order, optionally requiring visibility."""
    for selector in selectors:
        if await count(page, engine, selector) and (
            not visible or await is_visible(page, engine, selector)
        ):
            return selector
    return None


async def has_text(
    page: Any, engine: Any, texts: list[str], normalize_whitespace: bool = False
) -> bool:
    """Match any requested phrase against body.textContent, including Unicode whitespace."""
    adapter = create_engine_adapter(page, engine)
    return bool(
        await adapter.evaluate_on_page(
            r"""({texts, normalize}) => {
        const norm = value => normalize ? value.replace(/\s+/gu, ' ').trim() : value;
        const body = norm(document.body?.textContent ?? '');
        return texts.some(text => body.includes(norm(text)));
    }""",
            {"texts": texts, "normalize": normalize_whitespace},
        )
    )


async def is_checked(page: Any, engine: Any, selector: Any, index: int = 0) -> bool:
    """Observe the checked state of the selected checkbox or radio."""
    element = await get_locator_or_element(page, engine, selector, index=index)
    if element is None:
        return False
    return bool(
        await element.is_checked() if engine == "playwright" else element.is_selected()
    )


async def check(
    page: Any, engine: Any, selector: Any, checked: bool = True, index: int = 0
) -> dict:
    """Click a checkbox/radio only when its observed state needs to change."""
    element = await get_locator_or_element(page, engine, selector, index=index)
    if element is None:
        raise ValueError("checkbox or radio not found")
    kind = (
        await element.get_attribute("type")
        if engine == "playwright"
        else element.get_attribute("type")
    )
    kind = (kind or "").lower()
    if kind not in ("checkbox", "radio") or (kind == "radio" and not checked):
        raise ValueError("check requires a checkbox, or a radio being checked")
    before = await is_checked(page, engine, element)
    if before != checked:
        if engine == "playwright":
            await element.set_checked(checked)
        else:
            element.click()
    after = await is_checked(page, engine, element)
    return {"checked": after, "changed": before != after, "verified": after == checked}
