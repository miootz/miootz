import asyncio
from datetime import UTC, datetime
import json
from pathlib import Path
import subprocess
import sys

from httpx import ASGITransport, AsyncClient

from app import demo


def test_hosted_demo_preserves_progress_until_hourly_reset(tmp_path):
    # The demo replaces API adapters and database settings for its whole process.
    subprocess.run(
        [sys.executable, "-m", "app.tests.test_demo_reset", str(tmp_path)],
        check=True,
        timeout=30,
    )


async def exercise_hosted_demo(directory):
    timer_waiting = asyncio.Queue()
    hourly_tick = asyncio.Queue()

    async def advance_on_signal(seconds):
        assert seconds == 3600
        timer_waiting.put_nowait(None)
        await hourly_tick.get()

    demo.sleep = advance_on_signal
    demo.configure_environment(directory, 5180)
    app, _ = await demo.prepare(
        "full", datetime.now(UTC).replace(tzinfo=None), hourly_reset=True
    )

    async with (
        app.router.lifespan_context(app),
        AsyncClient(
            transport=ASGITransport(app=app), base_url="http://localhost"
        ) as client,
    ):
        await asyncio.wait_for(timer_waiting.get(), timeout=5)

        async def sign_in(role):
            response = await client.post(f"/demo/login/{role}")
            response.raise_for_status()
            saved = response.text.split("localStorage.setItem('miootz_tokens', ", 1)[1]
            tokens = json.loads(json.loads(saved.split(");", 1)[0]))
            return {"Authorization": f"Bearer {tokens['accessToken']}"}

        chat_path = "/meetups/1/chat"
        admin = await sign_in("admin")
        message = "Shared progress before the hourly reset"
        sent = await client.post(chat_path, headers=admin, json={"message": message})
        sent.raise_for_status()

        member = await sign_in("member")
        selection = await client.post("/demo/scenario/live")
        selection.raise_for_status()
        assert "Current scenario: Full" in selection.text
        chat = await client.get(chat_path, headers=member)
        chat.raise_for_status()
        assert message in {row["message"] for row in chat.json()}

        hourly_tick.put_nowait(None)
        await asyncio.wait_for(timer_waiting.get(), timeout=5)
        menu = await client.get("/demo")
        assert "Current scenario: Live" in menu.text
        for account in (admin, member):
            chat = await client.get(chat_path, headers=account)
            chat.raise_for_status()
            assert chat.json()
            assert message not in {row["message"] for row in chat.json()}


if __name__ == "__main__":
    asyncio.run(exercise_hosted_demo(Path(sys.argv[1])))
