import csv
import io
import json
from datetime import datetime
from tempfile import SpooledTemporaryFile
from zipfile import ZipFile

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.requests import ClientDisconnect

from app.api import data_export
from app.api.main import app
from app.core.database import Base, async_session, engine
from app.models.chat import ChatMessage
from app.models.guest_plus_one import GuestPlusOne
from app.models.invite import InviteToken
from app.models.match import MatchPenalty, MatchSubstitution, MeetupMatch
from app.models.match_editor_lease import MatchEditorLease
from app.models.match_goal import MatchGoal
from app.models.meetup import Attendance, MatchScore, Meetup
from app.models.rating import Rating
from app.models.user import User
from app.models.web_push_subscription import WebPushSubscription


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with engine.connect() as conn:
        await conn.exec_driver_sql("PRAGMA journal_mode=WAL")
    async with async_session() as db:
        db.add_all(
            [
                User(id=101, pocket_id_sub="admin-uuid", is_admin=True),
                User(
                    id=102,
                    sso_display_name="=SUM(1,2)",
                    sso_groups=["members"],
                    calculated_skill=4.5,
                ),
                User(id=103, sso_display_name="  \t@formula"),
                User(id=104, sso_display_name="'=literal", sso_groups=-1),
                User(id=105, sso_display_name="+formula"),
                User(id=106, sso_display_name="-formula"),
                User(id=107, sso_display_name="\r\ntext"),
            ]
        )
        await db.flush()
        db.add(
            Meetup(
                id=201,
                start_time=datetime(2026, 1, 3, 18),
                location='Stadium, "North"\nSecond line',
                manual_teams_json="[[102, 103]]",
            )
        )
        await db.flush()
        db.add(
            MeetupMatch(
                id=401,
                meetup_id=201,
                match_number=1,
                team_a_users="[102]",
                team_b_users="[103]",
                team_a_name="A",
                team_b_name="B",
                score_a=2,
                score_b=1,
            )
        )
        await db.flush()
        db.add_all(
            [
                Attendance(id=301, meetup_id=201, user_id=102),
                MatchScore(id=302, meetup_id=201, player_id=102, score=2, type="goal"),
                Rating(id=303, meetup_id=201, rater_id=102, ratee_id=103, score=4),
                MatchGoal(
                    id=501,
                    match_id=401,
                    team="a",
                    scorer_id=102,
                    clock_secs=500,
                    clock_minute=2,
                    recorded_by=101,
                    intent_id="goal-id",
                ),
                MatchPenalty(
                    id=502, match_id=401, team="a", scored=True, scorer_id=102
                ),
                MatchSubstitution(
                    id=503,
                    meetup_id=201,
                    match_id=401,
                    old_team_a_users="[102]",
                    old_team_b_users="[103]",
                    new_team_a_users="[103]",
                    new_team_b_users="[102]",
                    recorded_by=101,
                ),
                InviteToken(
                    token="secret-invite-xyz",
                    expires_at=datetime(2027, 1, 1),
                    user_id=102,
                ),
                GuestPlusOne(
                    id=601,
                    meetup_id=201,
                    inviter_id=102,
                    guest_user_id=103,
                    first_name="Guest",
                    last_name="Player",
                    skill=3,
                    claim_token="secret-claim-xyz",
                ),
                WebPushSubscription(
                    id=602,
                    user_id=102,
                    endpoint="secret-endpoint-xyz",
                    p256dh="secret-p256dh-xyz",
                    auth="secret-auth-xyz",
                ),
                MatchEditorLease(
                    match_id=401, holder_id=101, release_token="secret-release-xyz"
                ),
                ChatMessage(meetup_id=201, user_id=102, message="private-chat-xyz"),
            ]
        )
        await db.commit()
    yield


def _rows(archive, name):
    return list(
        csv.DictReader(io.StringIO(archive.read(name).decode("utf-8"), newline=""))
    )


@pytest.mark.asyncio
async def test_export_requires_admin():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/admin/export")).status_code == 401
        assert (
            await client.get("/admin/export", headers={"Authorization": "Bearer user"})
        ).status_code == 403


@pytest.mark.asyncio
async def test_export_preserves_dataset_and_omits_capabilities():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/admin/export", headers={"Authorization": "Bearer admin"}
        )

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["content-disposition"].startswith(
        'attachment; filename="miootz-export-'
    )
    assert response.headers["cache-control"] == "no-store"

    with ZipFile(io.BytesIO(response.content)) as archive:
        expected_tables = set(Base.metadata.tables) - {"chat_messages"}
        assert set(archive.namelist()) == {
            f"{table}.csv" for table in expected_tables
        } | {"foreign_keys.csv", "README.txt"}
        assert {
            "users",
            "meetups",
            "attendance",
            "match_scores",
            "meetup_matches",
            "match_goals",
            "match_penalties",
            "match_substitutions",
            "ratings",
        } <= expected_tables
        for table_name in expected_tables:
            assert archive.read(f"{table_name}.csv").splitlines()[0]
        assert _rows(archive, "game_templates.csv") == []

        users = {row["id"]: row for row in _rows(archive, "users.csv")}
        assert [int(row["id"]) for row in _rows(archive, "users.csv")] == sorted(
            map(int, users)
        )
        assert users["102"]["sso_display_name"] == "'=SUM(1,2)"
        assert users["103"]["sso_display_name"] == "'  \t@formula"
        assert users["104"]["sso_display_name"] == "''=literal"
        assert users["105"]["sso_display_name"] == "'+formula"
        assert users["106"]["sso_display_name"] == "'-formula"
        assert users["107"]["sso_display_name"] == "'\r\ntext"
        assert json.loads(users["102"]["sso_groups"]) == ["members"]
        assert json.loads(users["104"]["sso_groups"]) == -1
        assert "calculated_skill" not in users["102"]

        meetup = _rows(archive, "meetups.csv")[0]
        assert meetup["id"] == "201"
        assert meetup["location"] == 'Stadium, "North"\nSecond line'
        assert json.loads(meetup["manual_teams_json"]) == [[102, 103]]
        assert _rows(archive, "attendance.csv")[0]["user_id"] == "102"
        assert _rows(archive, "attendance.csv")[0]["meetup_id"] == meetup["id"]
        assert _rows(archive, "match_scores.csv")[0]["score"] == "2"
        match = _rows(archive, "meetup_matches.csv")[0]
        assert (
            match["id"],
            match["meetup_id"],
            match["score_a"],
            match["score_b"],
        ) == ("401", "201", "2", "1")
        assert json.loads(match["team_a_users"]) == [102]
        assert _rows(archive, "match_goals.csv")[0]["match_id"] == match["id"]
        assert _rows(archive, "match_penalties.csv")[0]["scored"] == "1"
        assert _rows(archive, "match_substitutions.csv")[0]["match_id"] == match["id"]
        assert _rows(archive, "ratings.csv")[0]["score"] == "4"

        foreign_keys = {
            (
                row["table"],
                row["column"],
                row["referenced_table"],
                row["referenced_column"],
            )
            for row in _rows(archive, "foreign_keys.csv")
        }
        assert foreign_keys == {
            (table.name, key.parent.name, key.column.table.name, key.column.name)
            for table in Base.metadata.tables.values()
            if table.name != "chat_messages"
            for key in table.foreign_keys
        }
        for table, omitted in {
            "invite_tokens": {"token"},
            "guest_plus_ones": {"claim_token"},
            "web_push_subscriptions": {"endpoint", "p256dh", "auth"},
            "match_editor_lease": {"release_token"},
        }.items():
            rows = _rows(archive, f"{table}.csv")
            assert len(rows) == 1
            assert omitted.isdisjoint(rows[0])

        contents = b"\n".join(archive.read(name) for name in archive.namelist())
        for secret in (
            b"secret-invite-xyz",
            b"secret-claim-xyz",
            b"secret-endpoint-xyz",
            b"secret-p256dh-xyz",
            b"secret-auth-xyz",
            b"secret-release-xyz",
            b"private-chat-xyz",
        ):
            assert secret not in contents


@pytest.mark.asyncio
async def test_export_reads_one_snapshot_during_concurrent_write(monkeypatch):
    write_table = data_export._write_table

    async def write_then_insert(archive, connection, table):
        await write_table(archive, connection, table)
        if table.name == "attendance":
            async with async_session() as db:
                db.add(User(id=999, sso_display_name="Inserted during export"))
                await db.commit()

    monkeypatch.setattr(data_export, "_write_table", write_then_insert)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/admin/export", headers={"Authorization": "Bearer admin"}
        )

    assert response.status_code == 200, response.text
    with ZipFile(io.BytesIO(response.content)) as archive:
        assert "999" not in {row["id"] for row in _rows(archive, "users.csv")}
    async with async_session() as db:
        assert await db.get(User, 999) is not None


@pytest.mark.asyncio
async def test_export_closes_file_after_disconnect():
    file = SpooledTemporaryFile()
    file.write(b"archive")
    file.seek(0)
    response = data_export._ArchiveResponse(file)

    async def send(message):
        if message["type"] == "http.response.body":
            raise OSError("client disconnected")

    async def receive():
        return {"type": "http.disconnect"}

    with pytest.raises(ClientDisconnect):
        await response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send)
    assert file.closed
