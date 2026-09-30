"""Bounded proof that the official run-driver wire protocol survives TCP stdio."""

import asyncio
import json
import secrets
import struct
from pathlib import Path

from browser_commander.utilities.subprocess import start_process


async def main():
    root = Path(__file__).resolve().parents[2]
    driver = root / ".venv/lib/python3.14/site-packages/playwright/driver"
    connected = asyncio.get_running_loop().create_future()

    async def accept(reader, writer):
        if not connected.done():
            connected.set_result((reader, writer))
        else:
            writer.close()

    async with await asyncio.start_server(accept, "127.0.0.1", 0) as server:
        token = secrets.token_hex(32)
        process = await start_process(
            str(driver / "node"),
            [
                str(Path(__file__).with_suffix(".cjs")),
                str(driver / "package/cli.js"),
                str(server.sockets[0].getsockname()[1]),
                token,
            ],
        )
        process.stderr.on("data", print)
        writer = None
        try:
            async with asyncio.timeout(15):
                reader, writer = await connected
                assert (await reader.readline()).decode().strip() == token
                message = json.dumps(
                    {
                        "id": 1,
                        "guid": "",
                        "method": "initialize",
                        "params": {"sdkLanguage": "python"},
                        "metadata": {},
                    }
                ).encode()
                writer.write(struct.pack("<I", len(message)) + message)
                await writer.drain()
                created = []
                for _ in range(256):
                    size = struct.unpack("<I", await reader.readexactly(4))[0]
                    assert size < 16 * 1024 * 1024
                    response = json.loads(await reader.readexactly(size))
                    if response.get("method") == "__create__":
                        created.append(response["params"]["type"])
                    if response.get("id") == 1:
                        assert "error" not in response, response
                        assert "Playwright" in created, created
                        print("Initialized official driver through TCP:", created)
                        break
                else:
                    raise AssertionError(
                        "No initialization response within 256 messages"
                    )
                writer.close()
                await writer.wait_closed()
                assert await process.wait() == 0
        finally:
            if writer is not None:
                writer.close()
            process.kill()
            await process.wait()


asyncio.run(main())
