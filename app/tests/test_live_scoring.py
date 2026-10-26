"""Live collaborative scoring: lease, goals, steward gate, timer idempotency.

Covers the plan §2/§4 surface:
- lease single-winner under concurrency, expiry steal, token checks
- goal intent replay, 90 s dedupe + force, score counters vs COUNT
- steward-state reasons, public goal log, idempotent timer
"""

import asyncio
import json
from datetime import datetime, timedelta, UTC

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.main import app
from app.core.database import Base, engine
from app.core.timeutil import utcnow
from app.models.match import SessionMatch
from app.models.match_editor_lease import MatchEditorLease
from app.models.match_goal import MatchGoal
from app.models.user import User


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


def hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def user_id_by_sub(db, sub: str) -> int:
    res = await db.execute(select(User).where(User.pocket_id_sub == sub))
    u = res.scalar_one()
    return u.id


async def make_live_setup(ac: AsyncClient, tokens, *, start_offset_minutes: int = 0):
    """Session + joins + two manual teams + match 1 created. Returns (sid, mid, ids)."""
    start = datetime.now(UTC).replace(tzinfo=None) + timedelta(
        minutes=start_offset_minutes
    )
    r = await ac.post(
        "/sessions/",
        json={
            "start_time": start.isoformat(),
            "location": "Live Pitch",
            "min_players": 1,
            "max_players": 10,
            "send_push_notifications": False,
        },
        headers=hdr("admin"),
    )
    assert r.status_code == 201, r.text
    sid = r.json()["id"]

    for t in tokens:
        rj = await ac.post(f"/sessions/{sid}/join", headers=hdr(t))
        assert rj.status_code == 200, rj.text
        assert rj.json()["status"] == "confirmed"

    # Two manual teams so matches/start is deterministic.
    async with AsyncSession(engine) as db:
        ids = {t: await user_id_by_sub(db, f"{t}-uuid") for t in tokens}
    half = max(len(tokens) // 2, 1)
    teams = [
        [str(ids[t]) for t in tokens[:half]],
        [str(ids[t]) for t in tokens[half:]],
    ]
    rt = await ac.patch(
        f"/sessions/{sid}/teams",
        json={"teams": teams},
        headers=hdr("admin"),
    )
    assert rt.status_code == 200, rt.text

    rs = await ac.post(f"/sessions/{sid}/matches/start", headers=hdr("admin"))
    assert rs.status_code == 201, rs.text
    body = rs.json()
    assert body["status"] == "started"
    mid = body["match"]["id"]

    # Open the presence window (start_time may be in the future).
    async with AsyncSession(engine) as db:
        res = await db.execute(select(SessionMatch).where(SessionMatch.id == mid))
        m = res.scalar_one()
        m.timer_started_at = datetime.now(UTC)
        m.timer_seconds_remaining = m.timer_total_seconds
        m.status = "active"
        await db.commit()
    return sid, mid, ids


# ── Lease ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_lease_single_winner_under_concurrency():
    tokens = ["p1", "p2", "p3", "tp1", "tp2"]
    async with await client() as ac:
        sid, mid, _ = await make_live_setup(ac, tokens)
        urls = [f"/sessions/{sid}/matches/lease/acquire"]
        # The lease is session-level; all five race for the same current match.
        del mid
        responses = await asyncio.gather(
            *[ac.post(urls[0], headers=hdr(t)) for t in tokens]
        )
        oks = [r for r in responses if r.status_code == 200]
        busys = [r for r in responses if r.status_code == 409]
        assert len(oks) == 1, [r.status_code for r in responses]
        assert len(busys) == 4
        assert oks[0].json()["lease_token"]
        assert oks[0].json()["expires_in"] == 45
        # Every loser is told exactly who won — never silent.
        assert len({b.json()["holder_name"] for b in busys}) == 1
        assert all(b.json()["expires_in"] > 0 for b in busys)


@pytest.mark.asyncio
async def test_lease_expiry_steal():
    async with await client() as ac:
        sid, mid, ids = await make_live_setup(ac, ["p1", "p2"])
        r1 = await ac.post(f"/sessions/{sid}/matches/lease/acquire", headers=hdr("p1"))
        assert r1.status_code == 200
        tok1 = r1.json()["lease_token"]

        # Force-expire the lease, then P2 steals it.
        async with AsyncSession(engine) as db:
            await db.execute(
                update(MatchEditorLease)
                .where(MatchEditorLease.match_id == mid)
                .values(expires_at=utcnow() - timedelta(seconds=1))
            )
            await db.commit()

        r2 = await ac.post(f"/sessions/{sid}/matches/lease/acquire", headers=hdr("p2"))
        assert r2.status_code == 200
        tok2 = r2.json()["lease_token"]
        assert tok2 != tok1

        # The old token no longer renews: P2 is named in the 409.
        rr = await ac.post(
            f"/sessions/{sid}/matches/lease/renew",
            json={"lease_token": tok1},
            headers=hdr("p1"),
        )
        assert rr.status_code == 409
        assert rr.json()["holder_name"] == "P2"


@pytest.mark.asyncio
async def test_renew_release_wrong_token_rejected():
    async with await client() as ac:
        sid, mid, _ = await make_live_setup(ac, ["p1", "p2"])
        r1 = await ac.post(f"/sessions/{sid}/matches/lease/acquire", headers=hdr("p1"))
        assert r1.status_code == 200

        # P2 holds no lease: renew and release with bogus tokens must fail,
        # naming P1 as the real holder.
        rr = await ac.post(
            f"/sessions/{sid}/matches/lease/renew",
            json={"lease_token": "bogus"},
            headers=hdr("p2"),
        )
        assert rr.status_code == 409
        assert rr.json()["holder_name"] == "P1"
        rl = await ac.post(
            f"/sessions/{sid}/matches/lease/release",
            json={"lease_token": "bogus"},
            headers=hdr("p2"),
        )
        assert rl.status_code == 409
        assert rl.json()["holder_name"] == "P1"

        # Correct token: renew extends, release frees for the next person.
        rr2 = await ac.post(
            f"/sessions/{sid}/matches/lease/renew",
            json={"lease_token": r1.json()["lease_token"]},
            headers=hdr("p1"),
        )
        assert rr2.status_code == 200
        assert rr2.json()["expires_in"] == 45
        rl2 = await ac.post(
            f"/sessions/{sid}/matches/lease/release",
            json={"lease_token": r1.json()["lease_token"]},
            headers=hdr("p1"),
        )
        assert rl2.status_code == 200
        assert rl2.json()["released"] is True
        r3 = await ac.post(f"/sessions/{sid}/matches/lease/acquire", headers=hdr("p2"))
        assert r3.status_code == 200


# ── Goals ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_goal_requires_lease_and_membership():
    async with await client() as ac:
        sid, mid, ids = await make_live_setup(ac, ["p1", "p2"])
        # Present member without the lease: 409 naming nobody (lease free).
        r = await ac.post(
            f"/sessions/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p2"],
                "intent_id": "i-1",
            },
            headers=hdr("p2"),
        )
        assert r.status_code == 409
        # Non-attending user: 403 before any lease logic even runs.
        r2 = await ac.post(
            f"/sessions/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p2"],
                "intent_id": "i-2",
            },
            headers=hdr("viewer"),
        )
        assert r2.status_code == 403
        assert r2.json()["detail"] == "not_attending"
        # Unauthenticated POST (not a whitelisted GET): 401.
        r3 = await ac.post(
            f"/sessions/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p2"],
                "intent_id": "i-3",
            },
        )
        assert r3.status_code == 401


@pytest.mark.asyncio
async def test_goal_intent_replay_returns_same_goal():
    async with await client() as ac:
        sid, mid, ids = await make_live_setup(ac, ["p1", "p2"])
        assert (
            await ac.post(f"/sessions/{sid}/matches/lease/acquire", headers=hdr("p1"))
        ).status_code == 200
        body = {
            "team": "a",
            "scorer_id": ids["p2"],
            "assist_id": ids["p1"],
            "intent_id": "intent-abc",
        }
        r1 = await ac.post(
            f"/sessions/{sid}/matches/{mid}/goals", json=body, headers=hdr("p1")
        )
        assert r1.status_code == 201, r1.text
        goal = r1.json()["goal"]
        assert r1.json()["replayed"] is False
        assert goal["scorer"]["display_name"] == "P2"
        assert goal["assist"]["display_name"] == "P1"
        assert goal["recorded_by"]["display_name"] == "P1"

        # Network retry with the same intent replays the stored row (200).
        r2 = await ac.post(
            f"/sessions/{sid}/matches/{mid}/goals", json=body, headers=hdr("p1")
        )
        assert r2.status_code == 200
        assert r2.json()["replayed"] is True
        assert r2.json()["goal"]["id"] == goal["id"]


@pytest.mark.asyncio
async def test_goal_dedupe_90s_and_force_bypass():
    async with await client() as ac:
        sid, mid, ids = await make_live_setup(ac, ["p1", "p2"])
        assert (
            await ac.post(f"/sessions/{sid}/matches/lease/acquire", headers=hdr("p1"))
        ).status_code == 200
        r1 = await ac.post(
            f"/sessions/{sid}/matches/{mid}/goals",
            json={"team": "a", "scorer_id": ids["p2"], "intent_id": "g-1"},
            headers=hdr("p1"),
        )
        assert r1.status_code == 201
        goal = r1.json()["goal"]

        # Freeze the clock so the minute cannot tick over mid-test.
        assert (
            await ac.post(
                f"/sessions/{sid}/matches/{mid}/timer/pause", headers=hdr("p1")
            )
        ).status_code == 200

        # Re-acquire the lease (creating g-1 released it).
        assert (
            await ac.post(f"/sessions/{sid}/matches/lease/acquire", headers=hdr("p1"))
        ).status_code == 200

        # Same (team, scorer, minute), fresh intent, no force: duplicate refused.
        r2 = await ac.post(
            f"/sessions/{sid}/matches/{mid}/goals",
            json={"team": "a", "scorer_id": ids["p2"], "intent_id": "g-2"},
            headers=hdr("p1"),
        )
        assert r2.status_code == 409
        assert r2.json()["detail"] == "duplicate_goal_within_90s"
        assert r2.json()["existing"]["id"] == goal["id"]

        # force:true confirms a genuine second goal in the same minute —
        # a fresh row, counted in the score (finding 2).
        r3 = await ac.post(
            f"/sessions/{sid}/matches/{mid}/goals",
            json={
                "team": "a",
                "scorer_id": ids["p2"],
                "intent_id": "g-3",
                "force": True,
            },
            headers=hdr("p1"),
        )
        assert r3.status_code == 201
        assert r3.json()["goal"]["id"] != goal["id"]
        assert r3.json()["score_a"] == 2


@pytest.mark.asyncio
async def test_score_counters_match_count_after_add_and_delete():
    async with await client() as ac:
        sid, mid, ids = await make_live_setup(ac, ["p1", "p2", "p3"])
        # Team A goal (P1 records P2).
        assert (
            await ac.post(f"/sessions/{sid}/matches/lease/acquire", headers=hdr("p1"))
        ).status_code == 200
        r1 = await ac.post(
            f"/sessions/{sid}/matches/{mid}/goals",
            json={"team": "a", "scorer_id": ids["p2"], "intent_id": "a-1"},
            headers=hdr("p1"),
        )
        assert r1.status_code == 201
        assert r1.json()["score_a"] == 1 and r1.json()["score_b"] == 0
        goal_a = r1.json()["goal"]["id"]

        # Team B goal (re-acquire the lease — creating g-1 released it).
        assert (
            await ac.post(f"/sessions/{sid}/matches/lease/acquire", headers=hdr("p1"))
        ).status_code == 200
        r2 = await ac.post(
            f"/sessions/{sid}/matches/{mid}/goals",
            json={"team": "b", "scorer_id": ids["p3"], "intent_id": "b-1"},
            headers=hdr("p1"),
        )
        assert r2.status_code == 201
        assert r2.json()["score_a"] == 1 and r2.json()["score_b"] == 1
        goal_b = r2.json()["goal"]["id"]

        # Public GET (no auth): exactly the two live rows, ordered by minute.
        rp = await ac.get(f"/sessions/{sid}/matches/{mid}/goals")
        assert rp.status_code == 200
        rows = rp.json()["goals"]
        assert [g["id"] for g in rows] == sorted(
            [g["id"] for g in rows], key=lambda i: (i,)
        )
        assert len(rows) == 2
        assert rp.json()["score_a"] == 1 and rp.json()["score_b"] == 1

        # Present member (P3) may delete while the window is open.
        rd = await ac.delete(
            f"/sessions/{sid}/matches/{mid}/goals/{goal_a}", headers=hdr("p3")
        )
        assert rd.status_code == 204
        rp2 = await ac.get(f"/sessions/{sid}/matches/{mid}/goals")
        assert [g["id"] for g in rp2.json()["goals"]] == [goal_b]
        assert rp2.json()["score_a"] == 0 and rp2.json()["score_b"] == 1

        # Non-attending user cannot delete: 403.
        rx = await ac.delete(
            f"/sessions/{sid}/matches/{mid}/goals/{goal_b}", headers=hdr("viewer")
        )
        assert rx.status_code == 403

        rd2 = await ac.delete(
            f"/sessions/{sid}/matches/{mid}/goals/{goal_b}", headers=hdr("admin")
        )
        assert rd2.status_code == 204

        # Counters equal COUNT(live goals) == 0/0, and rows really are soft-deleted
        # (still present in the table with deleted_at set).
        async with AsyncSession(engine) as db:
            res = await db.execute(select(MatchGoal).where(MatchGoal.match_id == mid))
            all_rows = list(res.scalars().all())
            assert len(all_rows) == 2
            assert all(g.deleted_at is not None for g in all_rows)
            m = await db.get(SessionMatch, mid)
            assert m is not None
            assert m.score_a == 0 and m.score_b == 0


# ── Timer idempotency ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_timer_double_taps_are_idempotent():
    async with await client() as ac:
        sid, mid, _ = await make_live_setup(ac, ["p1", "p2"], start_offset_minutes=-5)
        # make_live_setup already started; go back to a clean pending timer.
        rr = await ac.post(
            f"/sessions/{sid}/matches/{mid}/timer/reset", headers=hdr("p1")
        )
        assert rr.status_code == 200
        assert rr.json()["status"] == "pending"

        r1 = await ac.post(
            f"/sessions/{sid}/matches/{mid}/timer/start", headers=hdr("p1")
        )
        assert r1.status_code == 200
        assert r1.json()["already"] is False
        # Double tap start: same state, nothing re-created.
        r2 = await ac.post(
            f"/sessions/{sid}/matches/{mid}/timer/start", headers=hdr("p1")
        )
        assert r2.status_code == 200 and r2.json()["already"] is True

        r3 = await ac.post(
            f"/sessions/{sid}/matches/{mid}/timer/pause", headers=hdr("p2")
        )
        assert r3.status_code == 200 and r3.json()["already"] is False
        assert r3.json()["controlled_by"]["name"] == "P2"
        # Double tap pause: no second pause interval appended (the old bug).
        r4 = await ac.post(
            f"/sessions/{sid}/matches/{mid}/timer/pause", headers=hdr("p2")
        )
        assert r4.status_code == 200 and r4.json()["already"] is True

        r5 = await ac.post(
            f"/sessions/{sid}/matches/{mid}/timer/resume", headers=hdr("p2")
        )
        assert r5.status_code == 200 and r5.json()["already"] is False
        r6 = await ac.post(
            f"/sessions/{sid}/matches/{mid}/timer/resume", headers=hdr("p2")
        )
        assert r6.status_code == 200 and r6.json()["already"] is True

        async with AsyncSession(engine) as db:
            m = await db.get(SessionMatch, mid)
            assert m is not None
            intervals = json.loads(m.timer_pause_intervals or "[]")
            # Exactly one pause interval, and it has been resumed.
            assert len(intervals) == 1
            assert intervals[0]["resumed_at"] is not None


# ── Steward state ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_steward_state_reasons():
    async with await client() as ac:
        # Unauthenticated: 401.
        r0 = await ac.get("/sessions/1/steward-state")
        assert r0.status_code == 401

        sid_out, _, ids = await make_live_setup(
            ac, ["p1", "p2"], start_offset_minutes=2 * 24 * 60
        )
        # Confirmed attendee but the window has not opened: outside_window.
        r1 = await ac.get(f"/sessions/{sid_out}/steward-state", headers=hdr("p1"))
        assert r1.status_code == 200
        assert r1.json()["can_control"] is False
        assert r1.json()["reason"] == "outside_window"
        assert r1.json()["lease"] is None

        sid_live, mid, _ = await make_live_setup(ac, ["p1", "p2"])
        # Viewer confirmed? No — never joined: not_attending.
        r2 = await ac.get(f"/sessions/{sid_live}/steward-state", headers=hdr("viewer"))
        assert r2.status_code == 200
        assert r2.json()["can_control"] is False
        assert r2.json()["reason"] == "not_attending"

        # P1 (confirmed, window open) can control; after acquiring, the lease
        # names P1 with a positive countdown.
        r3 = await ac.get(f"/sessions/{sid_live}/steward-state", headers=hdr("p1"))
        assert r3.json()["can_control"] is True
        assert r3.json()["reason"] == "ok"
        assert r3.json()["lease"] is None
        assert (
            await ac.post(
                f"/sessions/{sid_live}/matches/lease/acquire", headers=hdr("p1")
            )
        ).status_code == 200
        r4 = await ac.get(f"/sessions/{sid_live}/steward-state", headers=hdr("p2"))
        assert r4.json()["lease"]["holder_name"] == "P1"
        assert 0 < r4.json()["lease"]["expires_in"] <= 45
        assert r4.json()["match_id"] == mid
