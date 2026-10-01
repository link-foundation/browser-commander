"""Debug: which mutation batches does a real Chromium yield after set_content/goto."""
import asyncio, json, sys, tempfile
from pathlib import Path
from playwright.async_api import async_playwright
from browser_commander import make_browser_commander
from browser_commander.traces import read_trace

HTML = "<!doctype html><ul id=list></ul><button id=add onclick=\"document.getElementById('list').appendChild(document.createElement('li'))\">add</button>"

async def main(use_set_content: bool) -> None:
    tmp = Path(tempfile.mkdtemp())
    (tmp / "a.html").write_text(HTML)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        page = await b.new_page()
        c = make_browser_commander(page, enable_network_tracking=False)
        t = await c.start_trace(output=str(tmp / "b"), mode="continuous", screenshots=False)
        if use_set_content:
            await c.goto((tmp / "a.html").as_uri())
            await page.set_content(HTML)
        else:
            await c.goto((tmp / "a.html").as_uri())
        await t.checkpoint("one")
        await page.click("#add")
        await t.checkpoint("two")
        s = await t.stop()
        await c.destroy()
        r = read_trace(s["path"])
        for e in r.events:
            if e["kind"] in ("mutations", "dropped", "checkpoint"):
                print(json.dumps(e)[:300])
        for i in range(1, len(r.checkpoints) + 1):
            print(i, r.checkpoints[i-1].name, json.dumps(r.mutations(i))[:300])
        await b.close()

asyncio.run(main(sys.argv[1] == "1"))
