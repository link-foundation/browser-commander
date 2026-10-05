"""Verify the shared commander API against each native Python engine (#124)."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from urllib.parse import quote

import pytest

from browser_commander import LaunchOptions, launch_browser, make_browser_commander
from browser_commander.core.engine_adapter import create_engine_adapter

pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(
        os.environ.get("RUN_E2E") != "true", reason="set RUN_E2E=true to run browsers"
    ),
]

HTML = """<title>Engine matrix</title><input id=name>
<button id=go onclick="document.querySelector('#out').textContent=document.querySelector('#name').value">Go</button>
<p id=out></p><p id=hidden style="display:none">Hidden text</p>"""


# feature-parity: engines.webdriver@native-typed
@pytest.mark.parametrize("engine", ["playwright", "selenium"])
@pytest.mark.parametrize("launch", ["real", "engine"])
async def test_shared_native_commander(
    engine: str, launch: str, tmp_path: Path
) -> None:
    async def exercise() -> None:
        args = ["--no-sandbox"] if os.environ.get("CHROME_NO_SANDBOX") == "true" else []
        session = await launch_browser(
            LaunchOptions(
                engine=engine,
                launch=launch,
                headless=True,
                args=args,
                executable_path=os.environ.get("CHROME_PATH", "/usr/bin/google-chrome"),
            )
        )
        commander = make_browser_commander(
            page=session.page,
            enable_network_tracking=False,
            enable_navigation_manager=False,
        )
        try:
            assert commander.engine == engine
            await commander.goto("data:text/html," + quote(HTML))
            assert await commander.count("input") == 1
            adapter = create_engine_adapter(session.page, engine)
            element = await adapter.query_selector("#name")
            assert (
                await adapter.evaluate_on_element(element, "(el) => el.tagName")
                == "INPUT"
            )
            assert (
                await adapter.evaluate_on_page("() => document.title")
                == "Engine matrix"
            )
            if engine == "selenium":
                assert (
                    await adapter.evaluate_on_element(element, "return el.tagName")
                    == "INPUT"
                )
                assert (
                    await adapter.evaluate_on_page("return document.title")
                    == "Engine matrix"
                )
            assert await commander.text_content("#hidden") == "Hidden text"
            await commander.fill_text_area("#name", "Ada", simulate_typing=False)
            assert await commander.input_value("#name") == "Ada"
            await commander.click_button("#go", wait_after_click=0)
            assert await commander.text_content("#out") == "Ada"
            pdf = await commander.pdf(format="A4", path=str(tmp_path / "page.pdf"))
            assert pdf.startswith(b"%PDF-")
            assert (tmp_path / "page.pdf").read_bytes() == pdf
        finally:
            await commander.destroy()
            await session.close()

    await asyncio.wait_for(exercise(), timeout=120)
