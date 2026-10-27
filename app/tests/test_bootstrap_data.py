import pytest
from sqlalchemy import func, select

import app.models.game_template  # noqa: F401 — Meetup FK metadata
from app.bootstrap_data import (
    DEMO_POCKET_ID_PREFIX,
    DEMO_MEETUP_LOCATION_PREFIX,
    run_bootstrap,
)
from app.core.database import Base, async_session, engine
from app.models.rating import Rating
from app.models.meetup import Attendance, Meetup
from app.models.user import User


@pytest.fixture(scope="function", autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


@pytest.mark.asyncio
async def test_bootstrap_creates_members_meetups_ratings():
    assert await run_bootstrap(force=False) == 0

    async with async_session() as db:
        n_users = (
            await db.execute(
                select(func.count()).select_from(User).where(
                    User.pocket_id_sub.like(f"{DEMO_POCKET_ID_PREFIX}%")
                )
            )
        ).scalar_one()
        assert n_users >= 20

        n_meetups = (
            await db.execute(
                select(func.count()).select_from(Meetup).where(
                    Meetup.location.like(f"{DEMO_MEETUP_LOCATION_PREFIX}%")
                )
            )
        ).scalar_one()
        assert n_meetups == 5

        n_att = (await db.execute(select(func.count()).select_from(Attendance))).scalar_one()
        assert 5 * 10 <= n_att <= 5 * 15

        n_ratings = (await db.execute(select(func.count()).select_from(Rating))).scalar_one()
        assert n_ratings > 0


@pytest.mark.asyncio
async def test_bootstrap_force_re_runs():
    assert await run_bootstrap(force=True) == 0
    assert await run_bootstrap(force=True) == 0


@pytest.mark.asyncio
async def test_demo_users_have_pocket_id_sub_and_positions():
    assert await run_bootstrap(force=False) == 0

    async with async_session() as db:
        result = await db.execute(
            select(User).where(User.pocket_id_sub.like(f"{DEMO_POCKET_ID_PREFIX}%"))
        )
        users = result.scalars().all()

        for user in users:
            assert user.pocket_id_sub is not None, f"{user.display_name} missing pocket_id_sub"
            assert user.primary_specialty in ("ATT", "MID", "DEF", "GK"), (
                f"{user.display_name} has invalid position {user.primary_specialty}"
            )
            assert user.sso_display_name is not None
