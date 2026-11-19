"""Lightweight additive SQLite migrations (no Alembic)."""

import json as _json
import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

logger = logging.getLogger(__name__)


async def run_sqlite_migrations(conn: AsyncConnection) -> None:
    async def has_column(table: str, col: str) -> bool:
        r = await conn.execute(text(f'PRAGMA table_info("{table}")'))
        rows = r.fetchall()
        return any(row[1] == col for row in rows)

    async def has_table(name: str) -> bool:
        r = await conn.execute(
            text("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:n LIMIT 1"),
            {"n": name},
        )
        return r.scalar_one_or_none() is not None

    if not await has_column("meetups", "min_players"):
        await conn.execute(
            text("ALTER TABLE meetups ADD COLUMN min_players INTEGER DEFAULT 10")
        )
    if not await has_column("meetups", "latitude"):
        await conn.execute(text("ALTER TABLE meetups ADD COLUMN latitude FLOAT"))
    if not await has_column("meetups", "longitude"):
        await conn.execute(text("ALTER TABLE meetups ADD COLUMN longitude FLOAT"))
    if not await has_column("meetups", "waitlist_mode"):
        await conn.execute(
            text(
                "ALTER TABLE meetups ADD COLUMN waitlist_mode VARCHAR DEFAULT 'auto_promote'"
            )
        )

    if not await has_column("attendance", "previous_status"):
        await conn.execute(
            text("ALTER TABLE attendance ADD COLUMN previous_status VARCHAR")
        )

    if not await has_column("meetups", "content_revision"):
        await conn.execute(
            text(
                "ALTER TABLE meetups ADD COLUMN content_revision INTEGER DEFAULT 0"
            )
        )

    if not await has_column("meetups", "team_assignment_mode"):
        await conn.execute(
            text(
                "ALTER TABLE meetups ADD COLUMN team_assignment_mode VARCHAR DEFAULT 'balanced'"
            )
        )

    if not await has_column("meetups", "kickoff_reminder_sent_at"):
        await conn.execute(
            text(
                "ALTER TABLE meetups ADD COLUMN kickoff_reminder_sent_at TIMESTAMP"
            )
        )

    if await has_table("ratings"):
        if not await has_column("ratings", "review"):
            await conn.execute(text("ALTER TABLE ratings ADD COLUMN review VARCHAR"))
        if not await has_column("ratings", "updated_at"):
            await conn.execute(
                text("ALTER TABLE ratings ADD COLUMN updated_at TIMESTAMP")
            )
            await conn.execute(
                text(
                    "UPDATE ratings SET updated_at = created_at WHERE updated_at IS NULL"
                )
            )
        ridx = await conn.execute(
            text(
                "SELECT 1 FROM sqlite_master WHERE type='index' AND name='uq_rating_meetup_rater_ratee' LIMIT 1"
            )
        )
        if ridx.scalar_one_or_none() is None:
            await conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_rating_meetup_rater_ratee "
                    "ON ratings (meetup_id, rater_id, ratee_id)"
                )
            )

    if not await has_column("meetups", "manual_teams_json"):
        await conn.execute(
            text("ALTER TABLE meetups ADD COLUMN manual_teams_json TEXT")
        )

    # (legacy) profile_pic columns are now removed - Pocket ID serves avatars.
    # Keep this migration for databases that still have the old columns.

    # Game templates: FK on meetups + copy legacy meetup_recurrence_rules → game_templates
    if not await has_column("users", "pocket_id_sub"):
        await conn.execute(text("ALTER TABLE users ADD COLUMN pocket_id_sub VARCHAR"))
        await conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_pocket_id_sub "
                "ON users (pocket_id_sub)"
            )
        )

    if not await has_column("meetups", "game_template_id"):
        await conn.execute(
            text("ALTER TABLE meetups ADD COLUMN game_template_id INTEGER")
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_meetups_game_template_id "
                "ON meetups (game_template_id)"
            )
        )

    if not await has_column("users", "primary_specialty"):
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN primary_specialty VARCHAR")
        )
    if not await has_column("users", "secondary_specialty"):
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN secondary_specialty VARCHAR")
        )

    if not await has_column("meetups", "duration_minutes"):
        await conn.execute(
            text("ALTER TABLE meetups ADD COLUMN duration_minutes INTEGER")
        )
    if not await has_column("meetups", "rating_reminder_sent_at"):
        await conn.execute(
            text(
                "ALTER TABLE meetups ADD COLUMN rating_reminder_sent_at TIMESTAMP"
            )
        )

    # ── Remove email from users; replace with display_name ──────────────
    # SQLite < 3.35 can't DROP COLUMN, so recreate the table.
    if await has_column("users", "email"):
        await conn.execute(
            text(
                """
                CREATE TABLE users_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username VARCHAR UNIQUE,
                    phone VARCHAR UNIQUE,
                    full_name VARCHAR,
                    profile_pic_original VARCHAR,
                    profile_pic VARCHAR,
                    avatar_crop_pixels TEXT,
                    skill_level INTEGER,
                    self_assessed_skill INTEGER,
                    calculated_skill FLOAT,
                    primary_specialty VARCHAR,
                    secondary_specialty VARCHAR,
                    is_admin INTEGER DEFAULT 0,
                    pocket_id_sub VARCHAR UNIQUE
                )
                """
            )
        )
        await conn.execute(
            text(
                """
                INSERT INTO users_new (
                    id, username, phone, full_name, profile_pic_original,
                    profile_pic, avatar_crop_pixels, skill_level,
                    self_assessed_skill, calculated_skill,
                    primary_specialty, secondary_specialty, is_admin, pocket_id_sub
                )
                SELECT
                    id, username, phone, full_name, profile_pic_original,
                    profile_pic, avatar_crop_pixels, skill_level,
                    self_assessed_skill, calculated_skill,
                    primary_specialty, secondary_specialty, is_admin, pocket_id_sub
                FROM users
                """
            )
        )
        await conn.execute(text("DROP TABLE users"))
        await conn.execute(text("ALTER TABLE users_new RENAME TO users"))
        # Recreate indexes
        await conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username)"
            )
        )
        await conn.execute(
            text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_phone ON users (phone)")
        )
        await conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_pocket_id_sub ON users (pocket_id_sub)"
            )
        )

    # ── Replace email with first_name + last_name in invite_tokens ──────
    if await has_column("invite_tokens", "email") and not await has_column(
        "invite_tokens", "first_name"
    ):
        await conn.execute(
            text(
                """
                CREATE TABLE invite_tokens_new (
                    token VARCHAR PRIMARY KEY,
                    first_name VARCHAR DEFAULT '',
                    last_name VARCHAR DEFAULT '',
                    created_at TIMESTAMP,
                    expires_at TIMESTAMP,
                    used INTEGER DEFAULT 0
                )
                """
            )
        )
        await conn.execute(
            text(
                """
                INSERT INTO invite_tokens_new (token, created_at, expires_at, used)
                SELECT token, created_at, expires_at, used FROM invite_tokens
                """
            )
        )
        await conn.execute(text("DROP TABLE invite_tokens"))
        await conn.execute(
            text("ALTER TABLE invite_tokens_new RENAME TO invite_tokens")
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_invite_tokens_first_name "
                "ON invite_tokens (first_name)"
            )
        )

    # ── guest_plus_ones table ────────────────────────────────────────
    if not await has_table("guest_plus_ones"):
        await conn.execute(
            text(
                """
                CREATE TABLE guest_plus_ones (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    meetup_id INTEGER NOT NULL REFERENCES meetups(id),
                    inviter_id INTEGER NOT NULL REFERENCES users(id),
                    guest_user_id INTEGER NOT NULL REFERENCES users(id),
                    first_name VARCHAR NOT NULL,
                    last_name VARCHAR NOT NULL,
                    self_assessed_skill INTEGER NOT NULL,
                    claim_token VARCHAR NOT NULL UNIQUE,
                    status VARCHAR NOT NULL DEFAULT 'pending',
                    claimed_by_user_id INTEGER REFERENCES users(id),
                    created_at TIMESTAMP,
                    claimed_at TIMESTAMP
                )
                """
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_guest_plus_ones_meetup_id "
                "ON guest_plus_ones (meetup_id)"
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_guest_plus_ones_inviter_id "
                "ON guest_plus_ones (inviter_id)"
            )
        )
        await conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_guest_plus_ones_claim_token "
                "ON guest_plus_ones (claim_token)"
            )
        )

    # ── Remove legacy skill_level column from users ──────────────────
    if await has_column("users", "skill_level"):
        r = await conn.execute(text("SELECT sqlite_version()"))
        version = r.scalar_one_or_none() or ""
        # SQLite >= 3.35 supports DROP COLUMN IF EXISTS
        if _parse_sqlite_version(version) >= (3, 35, 0):
            await conn.execute(
                text("ALTER TABLE users DROP COLUMN IF EXISTS skill_level")
            )
        else:
            # Recreate table without skill_level (same pattern as email removal)
            await conn.execute(
                text(
                    """
                    CREATE TABLE users_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        username VARCHAR UNIQUE,
                        phone VARCHAR UNIQUE,
                        full_name VARCHAR,
                        profile_pic_original VARCHAR,
                        profile_pic VARCHAR,
                        avatar_crop_pixels TEXT,
                        self_assessed_skill INTEGER,
                        calculated_skill FLOAT,
                        primary_specialty VARCHAR,
                        secondary_specialty VARCHAR,
                        is_admin INTEGER DEFAULT 0,
                        pocket_id_sub VARCHAR UNIQUE
                    )
                    """
                )
            )
            await conn.execute(
                text(
                    """
                    INSERT INTO users_new (
                        id, username, phone, full_name, profile_pic_original,
                        profile_pic, avatar_crop_pixels,
                        self_assessed_skill, calculated_skill,
                        primary_specialty, secondary_specialty, is_admin, pocket_id_sub
                    )
                    SELECT
                        id, username, phone, full_name, profile_pic_original,
                        profile_pic, avatar_crop_pixels,
                        self_assessed_skill, calculated_skill,
                        primary_specialty, secondary_specialty, is_admin, pocket_id_sub
                    FROM users
                    """
                )
            )
            await conn.execute(text("DROP TABLE users"))
            await conn.execute(text("ALTER TABLE users_new RENAME TO users"))
            await conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username)"
                )
            )
            await conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_phone ON users (phone)"
                )
            )
            await conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_pocket_id_sub ON users (pocket_id_sub)"
                )
            )

    # ── Cache SSO display name and groups from Pocket ID ─────────────
    if not await has_column("users", "sso_display_name"):
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN sso_display_name VARCHAR")
        )
    if not await has_column("users", "sso_preferred_username"):
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN sso_preferred_username VARCHAR")
        )
    if not await has_column("users", "sso_groups"):
        await conn.execute(text("ALTER TABLE users ADD COLUMN sso_groups TEXT"))
    if not await has_column("users", "sso_synced_at"):
        await conn.execute(text("ALTER TABLE users ADD COLUMN sso_synced_at TIMESTAMP"))

    # ── Remove local avatar columns (avatars now served by Pocket ID) ──
    for col in ("profile_pic", "profile_pic_original", "avatar_crop_pixels"):
        if await has_column("users", col):
            r = await conn.execute(text("SELECT sqlite_version()"))
            version = r.scalar_one_or_none() or ""
            if _parse_sqlite_version(version) >= (3, 35, 0):
                await conn.execute(text(f"ALTER TABLE users DROP COLUMN {col}"))
            else:
                # SQLite < 3.35 can't DROP COLUMN - leave stale columns
                logger.warning(
                    "Cannot drop column '%s' from users (SQLite < 3.35)", col
                )

    # ── Replace username with pocket_id_sub as primary identity ──
    # Remove: username, full_name, phone (if still present)
    # Make pocket_id_sub NOT NULL, backfill legacy users
    if await has_column("users", "username") or await has_column("users", "full_name"):
        # Backfill null pocket_id_sub with legacy identifier
        await conn.execute(
            text(
                """UPDATE users SET pocket_id_sub = 'legacy-' || id
                   WHERE pocket_id_sub IS NULL OR pocket_id_sub = ''"""
            )
        )

        r = await conn.execute(text("SELECT sqlite_version()"))
        version = r.scalar_one_or_none() or ""
        if _parse_sqlite_version(version) >= (3, 35, 0):
            # SQLite >= 3.35: can DROP columns
            # Drop indexes that reference columns we're about to remove
            await conn.execute(text("DROP INDEX IF EXISTS ix_users_username"))
            await conn.execute(text("DROP INDEX IF EXISTS ix_users_phone"))
            for col in ("username", "full_name", "phone"):
                if await has_column("users", col):
                    await conn.execute(text(f"ALTER TABLE users DROP COLUMN {col}"))
            # NOTE: SQLite doesn't support ALTER COLUMN SET NOT NULL (even 3.35+).
            # pocket_id_sub is already UNIQUE and backfilled above.
        else:
            # SQLite < 3.35: recreate table
            await conn.execute(
                text(
                    """
                    CREATE TABLE users_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        pocket_id_sub VARCHAR UNIQUE,
                        sso_display_name VARCHAR,
                        sso_groups TEXT,
                        self_assessed_skill INTEGER,
                        calculated_skill FLOAT,
                        primary_specialty VARCHAR,
                        secondary_specialty VARCHAR,
                        is_admin INTEGER DEFAULT 0
                    )
                    """
                )
            )
            await conn.execute(
                text(
                    """
                    INSERT INTO users_new (
                        id, pocket_id_sub, sso_display_name, sso_groups,
                        self_assessed_skill, calculated_skill,
                        primary_specialty, secondary_specialty, is_admin
                    )
                    SELECT
                        id,
                        COALESCE(NULLIF(pocket_id_sub, ''), 'legacy-' || id),
                        sso_display_name,
                        sso_groups,
                        self_assessed_skill,
                        calculated_skill,
                        primary_specialty,
                        secondary_specialty,
                        is_admin
                    FROM users
                    WHERE COALESCE(NULLIF(pocket_id_sub, ''), 'legacy-' || id) IS NOT NULL
                    """
                )
            )
            await conn.execute(text("DROP TABLE users"))
            await conn.execute(text("ALTER TABLE users_new RENAME TO users"))
            await conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_pocket_id_sub "
                    "ON users (pocket_id_sub)"
                )
            )

    if not await has_column("users", "historical_roster_name"):
        await conn.exec_driver_sql(
            "ALTER TABLE users ADD COLUMN historical_roster_name VARCHAR"
        )
    await conn.exec_driver_sql(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_historical_roster_name "
        "ON users (historical_roster_name)"
    )

    # ── Add pocket_id_user_id to invite_tokens ──
    if await has_table("invite_tokens") and not await has_column(
        "invite_tokens", "pocket_id_user_id"
    ):
        await conn.execute(
            text("ALTER TABLE invite_tokens ADD COLUMN pocket_id_user_id VARCHAR")
        )

    # ── Add user_id FK to invite_tokens (for inviting existing users) ──
    if await has_table("invite_tokens") and not await has_column(
        "invite_tokens", "user_id"
    ):
        await conn.execute(
            text(
                "ALTER TABLE invite_tokens ADD COLUMN user_id INTEGER REFERENCES users(id)"
            )
        )

    # ── Live match management ──
    if not await has_column("game_templates", "match_duration_minutes"):
        await conn.execute(
            text(
                "ALTER TABLE game_templates ADD COLUMN match_duration_minutes INTEGER DEFAULT 10"
            )
        )
    if not await has_column("meetups", "match_duration_minutes"):
        await conn.execute(
            text("ALTER TABLE meetups ADD COLUMN match_duration_minutes INTEGER")
        )

    # ── Draws: template flag + per-match record ────────────────────────
    if not await has_column("game_templates", "allows_draws"):
        await conn.execute(
            text("ALTER TABLE game_templates ADD COLUMN allows_draws BOOLEAN DEFAULT 0")
        )
    if not await has_column("meetup_matches", "was_draw"):
        await conn.execute(
            text("ALTER TABLE meetup_matches ADD COLUMN was_draw BOOLEAN DEFAULT 0")
        )

    # ── Weather: cached forecast + recorded actuals ───────────────────
    if not await has_column("meetups", "weather_forecast_temp_c"):
        await conn.execute(
            text("ALTER TABLE meetups ADD COLUMN weather_forecast_temp_c FLOAT")
        )
    if not await has_column("meetups", "weather_forecast_code"):
        await conn.execute(
            text("ALTER TABLE meetups ADD COLUMN weather_forecast_code INTEGER")
        )
    if not await has_column("meetups", "weather_forecast_label"):
        await conn.execute(
            text("ALTER TABLE meetups ADD COLUMN weather_forecast_label VARCHAR")
        )
    if not await has_column("meetups", "weather_forecast_fetched_at"):
        await conn.execute(
            text(
                "ALTER TABLE meetups ADD COLUMN weather_forecast_fetched_at TIMESTAMP"
            )
        )
    if not await has_column("meetups", "weather_actual_temp_c"):
        await conn.execute(
            text("ALTER TABLE meetups ADD COLUMN weather_actual_temp_c FLOAT")
        )
    if not await has_column("meetups", "weather_actual_code"):
        await conn.execute(
            text("ALTER TABLE meetups ADD COLUMN weather_actual_code INTEGER")
        )
    if not await has_column("meetups", "weather_actual_label"):
        await conn.execute(
            text("ALTER TABLE meetups ADD COLUMN weather_actual_label VARCHAR")
        )
    if not await has_column("meetups", "weather_actual_recorded_at"):
        await conn.execute(
            text(
                "ALTER TABLE meetups ADD COLUMN weather_actual_recorded_at TIMESTAMP"
            )
        )

    # ── Team names: persisted random names per meetup ─────────────────
    if not await has_column("meetups", "team_names_json"):
        await conn.execute(
            text("ALTER TABLE meetups ADD COLUMN team_names_json TEXT")
        )

    # Backfill team_names_json from existing meetup_matches (idempotent).
    if await has_table("meetup_matches"):
        _r = await conn.execute(
            text(
                """
                SELECT gs.id, GROUP_CONCAT(DISTINCT sn.team_a_name) || ',' ||
                       GROUP_CONCAT(DISTINCT sn.team_b_name) AS all_names
                FROM meetups gs
                JOIN meetup_matches sn ON sn.meetup_id = gs.id
                WHERE gs.team_names_json IS NULL
                GROUP BY gs.id
                """
            )
        )
        for _row in _r.fetchall():
            _sid, _all_names = _row
            _names = [
                _n.strip()
                for _n in _all_names.split(",")
                if _n.strip() and not _n.strip().startswith("Team ")
            ]
            _seen: set[str] = set()
            _unique: list[str] = []
            for _n in _names:
                if _n not in _seen:
                    _seen.add(_n)
                    _unique.append(_n)
            if _unique:
                await conn.execute(
                    text(
                        "UPDATE meetups SET team_names_json = :val WHERE id = :sid"
                    ),
                    {"val": _json.dumps(_unique), "sid": _sid},
                )

    # Generate team names for meetups that still have NULL (no matches yet).
    _needs_names = await conn.execute(
        text(
            """
            SELECT id, COALESCE(max_players, 15) AS mp
            FROM meetups
            WHERE team_names_json IS NULL
            """
        )
    )
    import random as _random

    _pool = [
        "Red Devils",
        "Blue Stars",
        "Golden Boot",
        "Iron Leg",
        "Thunder FC",
        "Lightning United",
        "Phoenix Rising",
        "Eagles Soar",
        "Crimson Tide",
        "Silver Arrows",
        "Wildcats",
        "Panthers",
        "Raptors",
        "Hawks",
        "Vipers",
        "Cobras",
        "Tigers",
        "Lions",
        "Sharks",
        "Wolves",
        "Galacticos",
        "Night Owls",
        "Fire Storm",
        "Ice Breakers",
        "Diamondbacks",
        "Steel City",
        "Rough Riders",
        "Storm Chasers",
        "Blaze",
        "Vendetta",
        "Renegades",
        "Warriors",
        "Gladiators",
        "Spartans",
        "Crusaders",
        "Titans",
        "Vikings",
        "Samurai",
        "Ninjas",
        "Phantoms",
        "Spectres",
        "Rebels",
        "Outlaws",
        "Bandits",
        "Corsairs",
        "Marauders",
        "Conquerors",
        "Legion",
        "Dynasty",
    ]
    _used_names: set[str] = set()
    # Collect already-used names to avoid repeats
    _existing = await conn.execute(
        text(
            "SELECT team_names_json FROM meetups WHERE team_names_json IS NOT NULL"
        )
    )
    for _erow in _existing.fetchall():
        try:
            for _en in _json.loads(_erow[0]):
                _used_names.add(_en)
        except Exception:
            pass
    for _nrow in _needs_names.fetchall():
        _nsid, _nmp = _nrow
        _nteam_count = 3 if _nmp >= 13 else 2
        _available = [n for n in _pool if n not in _used_names]
        if len(_available) >= _nteam_count:
            _picked = _random.sample(_available, _nteam_count)
        else:
            _picked = list(_available)
            while len(_picked) < _nteam_count:
                _picked.append(f"Team {len(_picked) + 1}")
        for _p in _picked:
            _used_names.add(_p)
        await conn.execute(
            text("UPDATE meetups SET team_names_json = :val WHERE id = :sid"),
            {"val": _json.dumps(_picked), "sid": _nsid},
        )

    # ── max_teams: upper bound on team count for dynamic expansion ──
    if not await has_column("meetups", "max_teams"):
        await conn.execute(
            text("ALTER TABLE meetups ADD COLUMN max_teams INTEGER")
        )

    if not await has_column("meetups", "team_size"):
        await conn.execute(text("ALTER TABLE meetups ADD COLUMN team_size INTEGER"))

    # ── match_goals.goalkeeper_id: the keeper who conceded (optional) ──
    # A fresh DB gets this column (and its index) from create_all; this block
    # only fires for a DB that already has match_goals from an earlier deploy.
    if await has_table("match_goals") and not await has_column(
        "match_goals", "goalkeeper_id"
    ):
        await conn.execute(
            text(
                "ALTER TABLE match_goals ADD COLUMN goalkeeper_id INTEGER "
                "REFERENCES users(id)"
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_match_goals_goalkeeper_id "
                "ON match_goals (goalkeeper_id)"
            )
        )

    # ── match_goals.is_own_goal: own goals are counted separately ──
    if await has_table("match_goals") and not await has_column(
        "match_goals", "is_own_goal"
    ):
        await conn.execute(
            text(
                "ALTER TABLE match_goals ADD COLUMN is_own_goal INTEGER DEFAULT 0"
            )
        )

    if await has_table("match_goals") and not await has_column("match_goals", "is_penalty"):
        await conn.exec_driver_sql("ALTER TABLE match_goals ADD COLUMN is_penalty BOOLEAN NOT NULL DEFAULT 0")

    # ── Manual score offsets: score = live goal COUNT + offset ──
    if not await has_column("meetup_matches", "score_offset_a"):
        await conn.execute(
            text(
                "ALTER TABLE meetup_matches ADD COLUMN score_offset_a "
                "INTEGER DEFAULT 0"
            )
        )
    if not await has_column("meetup_matches", "score_offset_b"):
        await conn.execute(
            text(
                "ALTER TABLE meetup_matches ADD COLUMN score_offset_b "
                "INTEGER DEFAULT 0"
            )
        )

    # The hard dedupe index on (match, team, minute, scorer) blocked a second
    # same-minute goal by the same player — the 90 s soft check is enough.
    await conn.execute(text("DROP INDEX IF EXISTS uq_match_goals_dedupe"))

    # ── One "next" match per (meetup, number): guarded end_match ──
    if await has_table("meetup_matches"):
        await conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_meetup_match_number "
                "ON meetup_matches (meetup_id, match_number)"
            )
        )

    # ── One materialized meetup per template kickoff instant ──
    # Fresh DBs get it from the model constraint; this covers existing DBs.
    # (game_template_id is NULL for ad-hoc meetups — SQLite treats NULLs as
    # distinct, so they are exempt.)
    if await has_table("meetups") and await has_column(
        "meetups", "game_template_id"
    ):
        await conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_meetup_template_start "
                "ON meetups (game_template_id, start_time)"
            )
        )

    # ── match_substitutions: pre-start roster-swap history ──
    if not await has_table("match_substitutions"):
        await conn.execute(
            text(
                """
                CREATE TABLE match_substitutions (
                    id INTEGER NOT NULL PRIMARY KEY,
                    meetup_id INTEGER NOT NULL REFERENCES meetups (id),
                    match_id INTEGER NOT NULL REFERENCES meetup_matches (id),
                    old_team_a_users TEXT NOT NULL,
                    old_team_b_users TEXT NOT NULL,
                    new_team_a_users TEXT NOT NULL,
                    new_team_b_users TEXT NOT NULL,
                    recorded_by INTEGER NOT NULL,
                    created_at DATETIME NOT NULL
                )
                """
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_match_substitutions_match_id "
                "ON match_substitutions (match_id)"
            )
        )

    # ── match_editor_lease.kind: the "roster" mode was never implemented ──
    if await has_table("match_editor_lease") and await has_column(
        "match_editor_lease", "kind"
    ):
        r = await conn.execute(text("SELECT sqlite_version()"))
        version = r.scalar_one_or_none() or ""
        if _parse_sqlite_version(version) >= (3, 35, 0):
            await conn.execute(
                text(
                    "ALTER TABLE match_editor_lease DROP COLUMN IF EXISTS kind"
                )
            )
        else:
            logger.warning(
                "Cannot drop column 'kind' from match_editor_lease (SQLite < 3.35)"
            )


    # ── Penalty shootout for tied first matches ──
    if not await has_column("meetup_matches", "penalty_winner"):
        await conn.execute(
            text("ALTER TABLE meetup_matches ADD COLUMN penalty_winner VARCHAR")
        )
    if not await has_column("meetup_matches", "penalty_score_a"):
        await conn.exec_driver_sql("ALTER TABLE meetup_matches ADD COLUMN penalty_score_a INTEGER")
    if not await has_column("meetup_matches", "penalty_score_b"):
        await conn.exec_driver_sql("ALTER TABLE meetup_matches ADD COLUMN penalty_score_b INTEGER")
    if not await has_table("match_penalties"):
        await conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS match_penalties (
                    id INTEGER NOT NULL PRIMARY KEY,
                    match_id INTEGER NOT NULL REFERENCES meetup_matches(id),
                    team VARCHAR NOT NULL,
                    scored BOOLEAN NOT NULL,
                    scorer_id INTEGER NOT NULL,
                    created_at DATETIME NOT NULL
                )
                """
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_match_penalties_match_id "
                "ON match_penalties (match_id)"
            )
        )

    # ── Mid-match (timer-paused) substitutions carry the match clock ──
    if not await has_column("match_substitutions", "clock_secs"):
        await conn.execute(
            text("ALTER TABLE match_substitutions ADD COLUMN clock_secs INTEGER")
        )

    # ── Weather Hero award (stacking spot guarantee) ──
    if not await has_table("weather_hero_awards"):
        await conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS weather_hero_awards (
                    id INTEGER NOT NULL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    granted_meetup_id INTEGER REFERENCES meetups(id),
                    granted_at DATETIME NOT NULL,
                    used_meetup_id INTEGER REFERENCES meetups(id),
                    used_at DATETIME
                )
                """
            )
        )
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_weather_hero_awards_user_id "
                "ON weather_hero_awards (user_id)"
            )
        )

    if not await has_column("weather_hero_awards", "import_source"):
        await conn.execute(
            text("ALTER TABLE weather_hero_awards ADD COLUMN import_source VARCHAR")
        )

    if not await has_column("meetups", "skipped"):
        await conn.execute(
            text("ALTER TABLE meetups ADD COLUMN skipped BOOLEAN DEFAULT 0")
        )

    if not await has_column("meetups", "fee_text"):
        await conn.execute(text("ALTER TABLE meetups ADD COLUMN fee_text VARCHAR"))

    if not await has_column("game_templates", "fee_text"):
        await conn.execute(text("ALTER TABLE game_templates ADD COLUMN fee_text VARCHAR"))

    # ── Single calculated rating: drop users.self_assessed_skill ──────
    if await has_column("users", "self_assessed_skill"):
        r = await conn.execute(text("SELECT sqlite_version()"))
        version = r.scalar_one_or_none() or ""
        if _parse_sqlite_version(version) >= (3, 35, 0):
            await conn.execute(
                text("ALTER TABLE users DROP COLUMN self_assessed_skill")
            )
        else:
            # SQLite < 3.35 can't DROP COLUMN - leave stale column
            logger.warning(
                "Cannot drop column 'self_assessed_skill' from users (SQLite < 3.35)"
            )

    # ── Plus-one: rename self_assessed_skill to skill ─────────────────
    if await has_column("guest_plus_ones", "self_assessed_skill"):
        r = await conn.execute(text("SELECT sqlite_version()"))
        version = r.scalar_one_or_none() or ""
        if _parse_sqlite_version(version) >= (3, 25, 0):
            await conn.execute(
                text(
                    "ALTER TABLE guest_plus_ones "
                    "RENAME COLUMN self_assessed_skill TO skill"
                )
            )
        else:
            # SQLite < 3.25 can't RENAME COLUMN - add + copy
            if not await has_column("guest_plus_ones", "skill"):
                await conn.execute(
                    text("ALTER TABLE guest_plus_ones ADD COLUMN skill INTEGER")
                )
                await conn.execute(
                    text(
                        "UPDATE guest_plus_ones SET skill = self_assessed_skill"
                    )
                )


    if not await has_column("users", "seed_skill"):
        await conn.execute(text("ALTER TABLE users ADD COLUMN seed_skill FLOAT"))
        # Pending reminders for meetups without a set duration used the old 60-minute default.
        if await has_table("job_queue"):
            await conn.execute(text("""
                UPDATE job_queue
                SET run_at = (
                    SELECT datetime(substr(start_time, 1, 19), '+120 minutes') || substr(start_time, 20)
                    FROM meetups WHERE id = job_queue.ref_id
                )
                WHERE job_type = 'rating_reminder' AND ref_id IN (
                    SELECT id FROM meetups WHERE coalesce(duration_minutes, 0) = 0
                )
            """))

    for column in ("pac", "dri", "sho_override", "pas_override", "def_override"):
        if not await has_column("users", column):
            await conn.execute(text(f"ALTER TABLE users ADD COLUMN {column} FLOAT"))


def _parse_sqlite_version(version: str) -> tuple[int, ...]:
    """Parse '3.35.1' -> (3, 35, 1)."""
    try:
        return tuple(int(p) for p in version.split(".") if p.isdigit())
    except ValueError:
        return (0,)
