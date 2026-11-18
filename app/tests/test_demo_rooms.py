import asyncio
from datetime import UTC, datetime
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

from httpx import ASGITransport, AsyncClient
import pytest

from app import demo


def check_guest_redirect(html, room):
    other = "matchday" if room == "squad" else "squad"
    pattern = html.split("returnPath && /^", 1)[1].split("$/.test(returnPath)", 1)[0]
    assert re.fullmatch(pattern, f"/{room}/plus-one/shared-token_123")
    assert not re.fullmatch(pattern, f"/{other}/plus-one/shared-token")
    assert not re.fullmatch(pattern, f"https://evil.example/{room}/plus-one/shared-token")
    assert not re.fullmatch(pattern, f"/{room}/plus-one/../other")

    node = shutil.which("node")
    if node:
        script = html.split("<script>", 1)[1].split("</script>", 1)[0]
        subprocess.run(
            [node, "-e", """
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {script, room, other} = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const key = `miootz_return_path:/${room}`;
const otherKey = `miootz_return_path:/${other}`;
const fallback = `/${room}/plus-one/demo-guest-reservation`;
for (const [input, expected] of [
  [`/${room}/plus-one/shared-token_123`, `/${room}/plus-one/shared-token_123`],
  [`/${other}/plus-one/token`, fallback],
  [`https://evil.example/${room}/plus-one/token`, fallback],
  [`//evil.example/${room}/plus-one/token`, fallback],
  [`/${room}/plus-one/../other`, fallback],
  [`/${room}/plus-one/token?next=other`, fallback],
  [`/${room}/plus-one/token\\n`, fallback],
  [null, fallback],
]) {
  const session = new Map([[key, input], [otherKey, 'keep']]);
  const local = new Map([[`miootz_tokens:/${other}`, 'keep']]);
  let result;
  vm.runInNewContext(script, {
    localStorage: {setItem: (k, v) => local.set(k, v)},
    sessionStorage: {getItem: (k) => session.get(k), removeItem: (k) => session.delete(k)},
    location: {replace: (value) => { result = value; }},
  });
  assert.equal(result, expected);
  assert.equal(session.has(key), false);
  assert.equal(session.get(otherKey), 'keep');
  assert.equal(local.get(`miootz_tokens:/${other}`), 'keep');
}
"""],
            input=json.dumps({"script": script, "room": room, "other": other}),
            text=True,
            check=True,
        )


@pytest.mark.parametrize("room", ["squad", "matchday"])
def test_room_fixtures_and_idle_reset(tmp_path, room):
    # Each demo owns its process-wide database and auth adapters.
    subprocess.run(
        [sys.executable, "-m", "app.tests.test_demo_rooms", str(tmp_path), room],
        check=True,
        timeout=45,
    )


async def exercise_room(directory, room):
    clock = [0.0]
    waiting = asyncio.Queue()
    wake = asyncio.Queue()

    async def controlled_sleep(seconds):
        waiting.put_nowait(seconds)
        await wake.get()

    demo.sleep = controlled_sleep
    demo.monotonic = lambda: clock[0]
    demo.configure_environment(directory, 5180)
    app, manifest = await demo.prepare(
        "full", datetime.now(UTC).replace(tzinfo=None, microsecond=0), room=room
    )
    assert manifest["scenario"] == ("squad" if room == "squad" else "kickoff")
    assert manifest["confirmed"] == (14 if room == "squad" else 16)
    assert manifest["waitlisted"] == 0

    # Hold a write across the idle deadline to verify that reset waits for it.
    write_started = asyncio.Event()
    finish_write = asyncio.Event()

    @app.post("/test/slow-write")
    async def slow_write():
        from app.core.database import async_session
        from app.models.chat import ChatMessage

        write_started.set()
        await finish_write.wait()
        async with async_session() as db:
            db.add(ChatMessage(meetup_id=1, user_id=1, message="Finished at deadline"))
            await db.commit()
        return {"ok": True}

    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url="http://localhost") as client,
    ):
        assert await asyncio.wait_for(waiting.get(), 5) == 3600

        async def sign_in(role):
            response = await client.post(f"/demo/login/{role}")
            response.raise_for_status()
            key = f"miootz_tokens:/{room}"
            saved = response.text.split(f"localStorage.setItem('{key}', ", 1)[1]
            tokens = json.loads(json.loads(saved.split(");", 1)[0]))
            expected = f"/{room}/plus-one/demo-guest-reservation" if role == "guest" else f"/{room}/"
            if role == "guest":
                assert json.dumps(expected) in response.text
                check_guest_redirect(response.text, room)
            else:
                assert f'location.replace("{expected}")' in response.text
            assert "localStorage.removeItem" not in response.text
            assert f"sessionStorage.removeItem('miootz_return_path:/{room}')" in response.text
            assert "caches.delete" not in response.text
            return {"Authorization": f"Bearer {tokens['accessToken']}"}

        lobby = await client.get("/demo/rooms")
        assert lobby.status_code == 200
        assert '/squad/api/demo' in lobby.text and '/matchday/api/demo' in lobby.text
        chooser = await client.get("/demo")
        assert chooser.status_code == 200
        assert f'/{room}/api/demo/login/admin' in chooser.text
        assert "60 min" in chooser.text
        assert (await client.get("/me")).status_code == 401
        assert (await client.post("/demo/activity")).status_code == 401
        assert (await client.post("/demo/scenario/live")).status_code == 401

        admin = await sign_in("admin")
        member = await sign_in("member")
        await sign_in("guest")
        assert (await client.post("/demo/scenario/live", headers=admin)).status_code == 404
        teams = await client.get("/meetups/1/teams", headers=admin)
        assert len(teams.json()["teams"]) >= 3
        matches = await client.get("/meetups/1/matches", headers=member)
        matches.raise_for_status()
        assert [m["status"] for m in matches.json()["matches"]] == (
            [] if room == "squad" else ["pending"]
        )

        if room == "squad":
            newcomer = await sign_in("newcomer")
            second = await sign_in("waitlisted")
            join = await client.post("/meetups/1/join", headers=newcomer)
            assert join.json()["status"] == "confirmed"
            join = await client.post("/meetups/1/join", headers=second)
            assert join.json()["status"] == "waitlisted"
        else:
            match_id = matches.json()["matches"][0]["id"]
            lease = await client.post(
                f"/meetups/1/matches/lease/acquire?match_id={match_id}", headers=admin
            )
            lease.raise_for_status()
            lease_token = lease.json()["lease_token"]

        clock[0] = 1000
        activity = await client.post("/demo/activity", headers=member)
        assert activity.status_code == 204 and not activity.content
        clock[0] = 3600
        assert (await client.get("/me", headers=member)).status_code == 200
        assert (await client.post("/demo/activity")).status_code == 401
        assert (await client.post("/demo/login/unknown")).status_code == 404
        if room == "matchday":
            renewal = await client.post(
                f"/meetups/1/matches/lease/renew?match_id={match_id}",
                headers=admin,
                json={"lease_token": lease_token},
            )
            renewal.raise_for_status()
        wake.put_nowait(None)
        assert await asyncio.wait_for(waiting.get(), 5) == 1000

        # A completed game write also keeps the room alive.
        clock[0] = 4100
        chat = await client.post(
            "/meetups/1/chat", headers=admin, json={"message": "Shared progress"}
        )
        chat.raise_for_status()
        await sign_in("member")
        chat = await client.get("/meetups/1/chat", headers=member)
        assert "Shared progress" in {row["message"] for row in chat.json()}
        clock[0] = 4600
        wake.put_nowait(None)
        assert await asyncio.wait_for(waiting.get(), 5) == 3100

        # The reset cannot discard a write already in flight at its deadline.
        clock[0] = 7700
        pending_write = asyncio.create_task(client.post("/test/slow-write", headers=admin))
        await asyncio.wait_for(write_started.wait(), 5)
        wake.put_nowait(None)
        await asyncio.sleep(0)
        finish_write.set()
        assert (await pending_write).status_code == 200
        assert await asyncio.wait_for(waiting.get(), 5) == 3600
        chat = await client.get("/meetups/1/chat", headers=member)
        assert {"Shared progress", "Finished at deadline"} <= {
            row["message"] for row in chat.json()
        }

        clock[0] = 11300
        # Polling does not defer the reset, and the original tokens still work afterward.
        assert (await client.get("/me", headers=member)).status_code == 200
        wake.put_nowait(None)
        assert await asyncio.wait_for(waiting.get(), 5) == 3600
        for account in (admin, member):
            chat = await client.get("/meetups/1/chat", headers=account)
            chat.raise_for_status()
            assert "Shared progress" not in {row["message"] for row in chat.json()}
            assert "Finished at deadline" not in {row["message"] for row in chat.json()}
        reset_matches = await client.get("/meetups/1/matches", headers=member)
        assert [m["status"] for m in reset_matches.json()["matches"]] == (
            [] if room == "squad" else ["pending"]
        )
        if room == "squad":
            assert (await client.post("/meetups/1/join", headers=newcomer)).json()["status"] == "confirmed"
            assert (await client.post("/meetups/1/join", headers=second)).json()["status"] == "waitlisted"


if __name__ == "__main__":
    asyncio.run(exercise_room(Path(sys.argv[1]), sys.argv[2]))
