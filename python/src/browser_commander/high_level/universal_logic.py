"""Universal high-level functions following DRY principles.

These are pure functions that work with any browser automation engine.
"""

from __future__ import annotations

from typing import Any, Callable

from browser_commander.core.navigation_safety import is_navigation_error


async def wait_for_url_condition(
    get_url: Callable[[], str],
    wait_fn: Callable[[int, str], Any],
    evaluate_fn: Callable[[str, list], Any],
    target_url: str,
    description: str | None = None,
    custom_check: Callable[[str], Any] | None = None,
    page_closed_callback: Callable[[], bool] | None = None,
    polling_interval: int = 1000,
) -> Any:
    """Wait indefinitely for a URL condition with custom check function.

    Args:
        get_url: Function to get current URL
        wait_fn: Wait function (ms, reason) -> Any
        evaluate_fn: Evaluate function (fn, args) -> Any
        target_url: Target URL to wait for
        description: Description for logging
        custom_check: Optional custom check function (async)
        page_closed_callback: Callback to check if page closed
        polling_interval: Polling interval in ms (default: 1000)

    Returns:
        Result from custom_check or True if URL matched
    """
    if page_closed_callback is None:

        def page_closed_callback():
            return False

    if description:
        print(f"Waiting: {description}...")

    while True:
        if page_closed_callback():
            return None

        try:
            # Run custom check if provided
            if custom_check:
                custom_result = await custom_check(get_url())
                if custom_result is not None:
                    return custom_result

            # Check if target URL reached
            current_url = get_url()
            if current_url.startswith(target_url):
                return True

        except Exception as error:
            if page_closed_callback():
                return None

            # Handle navigation errors gracefully
            if is_navigation_error(error):
                print("Navigation detected during URL check, continuing to wait...")
            else:
                error_msg = str(error)[:100]
                print(f"Temporary error while checking URL: {error_msg}... (retrying)")

        await wait_fn(polling_interval, "polling interval before next URL check")


async def install_click_listener(
    evaluate_fn: Callable[[str, list], Any],
    button_text: str,
    storage_key: str,
) -> bool:
    """Install click detection listener on page.

    Args:
        evaluate_fn: Evaluate function (fn, args) -> Any
        button_text: Text to detect
        storage_key: SessionStorage key to set

    Returns:
        True if installed, False on navigation
    """
    js_code = """
    (text, key) => {
        const handlers = window.__browserCommanderClickListeners ??= new Map();
        const previous = handlers.get(key);
        if (previous) document.removeEventListener('click', previous, true);
        const handler = (event) => {
            let element = event.target;
            while (element && element !== document.body) {
                const elementText = element.textContent?.trim() || '';
                if (elementText === text ||
                    ((element.tagName === 'A' || element.tagName === 'BUTTON') &&
                      elementText.includes(text))) {
                    console.log(`[Click Listener] Detected click on ${text} button!`);
                    window.sessionStorage.setItem(key, 'true');
                    break;
                }
                element = element.parentElement;
            }
        };
        handlers.set(key, handler);
        document.addEventListener('click', handler, true);
    }
    """

    try:
        result = await evaluate_fn(js_code, [button_text, storage_key])
        return result is not False
    except Exception as e:
        if is_navigation_error(e):
            print("Navigation detected during install_click_listener, skipping")
            return False
        raise


async def check_and_clear_flag(
    evaluate_fn: Callable[[str, list], Any],
    storage_key: str,
) -> bool:
    """Check and clear session storage flag.

    Args:
        evaluate_fn: Evaluate function (fn, args) -> Any
        storage_key: SessionStorage key

    Returns:
        True if flag was set, False otherwise or on navigation
    """
    js_code = """
    (key) => {
        const flag = window.sessionStorage.getItem(key);
        if (flag === 'true') {
            window.sessionStorage.removeItem(key);
            return true;
        }
        return false;
    }
    """

    try:
        return await evaluate_fn(js_code, [storage_key])
    except Exception as e:
        if is_navigation_error(e):
            print("Navigation detected during check_and_clear_flag, returning False")
            return False
        raise


async def find_toggle_button(
    count_fn: Callable[[str], Any],
    find_by_text_fn: Callable[[str, str], str],
    data_qa_selectors: list[str] | None = None,
    text_to_find: str | None = None,
    element_types: list[str] | None = None,
    texts: list[str] | None = None,
) -> str | None:
    """Find toggle button using multiple strategies.

    Args:
        count_fn: Count function (selector) -> int
        find_by_text_fn: FindByText function (text, selector) -> str
        data_qa_selectors: Data-qa selectors to try
        text_to_find: Text to search for
        element_types: Element types to search

    Returns:
        Selector or None
    """
    if data_qa_selectors is None:
        data_qa_selectors = []
    if element_types is None:
        element_types = ["button", "a", "span"]

    # Try data-qa selectors first
    for sel in data_qa_selectors:
        elem_count = await count_fn(sel)
        if elem_count > 0:
            return sel

    for text in (
        texts if texts is not None else ([text_to_find] if text_to_find else [])
    ):
        for element_type in element_types:
            selector = await find_by_text_fn(text, element_type)
            if await count_fn(selector) > 0:
                return selector

    return None


async def read_flag(evaluate_fn, storage_key: str) -> dict:
    """Observe a flag without clearing it; interrupted reads have no observed value."""
    try:
        value = await evaluate_fn(
            "key => sessionStorage.getItem(key) === 'true'", [storage_key]
        )
        return {"status": "observed", "set": bool(value)}
    except Exception as error:
        if is_navigation_error(error):
            return {"status": "interrupted", "set": None}
        raise


async def uninstall_click_listener(evaluate_fn, storage_key: str) -> bool:
    """Remove the retained click handler for this storage key."""
    return bool(
        await evaluate_fn(
            """key => {
        const handlers = window.__browserCommanderClickListeners;
        const handler = handlers?.get(key);
        if (!handler) return false;
        document.removeEventListener('click', handler, true); handlers.delete(key); return true;
    }""",
            [storage_key],
        )
    )
