from datetime import datetime
import json
import sqlite3
from uuid import UUID

import pytest

from scripts.import_team_maker import (
    AWARD_SOURCE,
    ROSTER_COLUMNS,
    STAT_COLUMNS,
    import_workbook,
    night_date,
    parse_workbook,
)


class Sheet(list):
    def iter_rows(self, *, max_col, values_only):
        assert values_only
        return (tuple(row[:max_col]) for row in self)


async def test_team_maker_import_is_idempotent(tmp_path):
    day = datetime(2024, 4, 15)
    workbook = {
        "Roster": Sheet(
            [
                ROSTER_COLUMNS,
                ("Alex Example", 1, None, None, None, None, None, 2),
                ("Casey Sample", 5, None, None, None, None, None, 1),
                ("Jordan Fixture", 2, None, None, None, None, None, None),
                ("Taylor Mock", 3, None, None, None, None, None, 0),
            ]
        ),
        "Lineups": Sheet(
            [
                ("Date", "Team A", "Team B", "Team C", "Notes"),
                (day, "Allex Example", "Jordan Fixture", "Casey Sample", None),
                (None, None, None, "Taylor Mock", None),
            ]
        ),
        "Matches": Sheet(
            [
                (
                    "Date",
                    "Match #",
                    "Sits out",
                    "Team 1",
                    "Team 2",
                    "Goals T1",
                    "Goals T2",
                    "Pens winner",
                    "Winner",
                ),
                (day, 1, "B", "A", "C", 1, 1, "C", "C"),
                (day, 2, "A", "C", "B", 2, 0, None, "C"),
            ]
        ),
        "Swaps": Sheet(
            [
                ("Date", "From match #", "Player", "To team", "To match #"),
                (day, 2, "Taylor Mock", "out", None),
            ]
        ),
        "Goals": Sheet(
            [
                ("Date", "Match #", "Scorer", "Type", "Assist"),
                (day, 1, "Alex Example", "Goal", None),
                (day, 1, "Casey Sample", "Goal", "Taylor Mock"),
                (day, 1, "Alex Example", "Shootout missed", None),
                (day, 1, "Casey Sample", "Shootout scored", None),
                (day, 2, "Casey Sample", "Penalty", None),
                (day, 2, "Casey Sample", "Goal", None),
            ]
        ),
        "Stats": Sheet(
            [
                ("Player", *STAT_COLUMNS),
                ("Alex Example", 1, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0),
                ("Casey Sample", 1, 2, 2, 0, 1, 3, 0, 0, 1.5, 0, 1.5, 2, 2, 1),
                ("Jordan Fixture", 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
                ("Taylor Mock", 1, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0),
            ]
        ),
    }
    ratings, tokens, nights, expected, warnings = parse_workbook(workbook)
    assert "matched 'Allex Example' to 'Alex Example'" in warnings[0]
    assert tokens == {"Alex Example": 2, "Casey Sample": 1, "Jordan Fixture": 0, "Taylor Mock": 0}
    assert night_date(datetime(2024, 3, 19)).day == 12
    database = tmp_path / "miootz.db"
    subject = str(UUID(int=1))
    with sqlite3.connect(database) as db:
        db.execute(
            "CREATE TABLE weather_hero_awards ("
            "id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), "
            "granted_meetup_id INTEGER REFERENCES meetups(id), granted_at DATETIME NOT NULL, "
            "used_meetup_id INTEGER REFERENCES meetups(id), used_at DATETIME)"
        )
    assert (
        await import_workbook(
            database, ratings, tokens, nights, expected, {"Alex Example": subject}
        )
        == []
    )

    with sqlite3.connect(database) as db:
        assert db.execute(
            "SELECT u.historical_roster_name, COUNT(*) FROM weather_hero_awards a "
            "JOIN users u ON u.id = a.user_id WHERE a.import_source = ? "
            "AND a.granted_meetup_id IS NULL GROUP BY u.historical_roster_name "
            "ORDER BY u.historical_roster_name",
            (AWARD_SOURCE,),
        ).fetchall() == [("Alex Example", 2), ("Casey Sample", 1)]
        assert db.execute(
            "SELECT calculated_skill FROM users WHERE is_admin ORDER BY historical_roster_name"
        ).fetchall() == [(5.0,), (0.0,)]
        assert db.execute(
            "SELECT score_a, score_b, penalty_score_a, penalty_score_b, penalty_winner "
            "FROM meetup_matches WHERE match_number = 1"
        ).fetchone() == (1, 1, 0, 1, "b")
        old, new = db.execute(
            "SELECT old_team_a_users, new_team_a_users FROM match_substitutions"
        ).fetchone()
        Taylor Mock = db.execute(
            "SELECT id FROM users WHERE historical_roster_name = 'Taylor Mock'"
        ).fetchone()[0]
        assert set(json.loads(old)) - set(json.loads(new)) == {Taylor Mock}
        db.execute(
            "UPDATE users SET sso_preferred_username = 'updated', calculated_skill = 3 "
            "WHERE pocket_id_sub = ?",
            (subject,),
        )
        db.execute(
            "INSERT INTO weather_hero_awards (user_id, granted_meetup_id, granted_at) "
            "SELECT id, (SELECT id FROM meetups LIMIT 1), '2026-11-18' "
            "FROM users WHERE historical_roster_name = 'Alex Example'"
        )
        db.execute(
            "UPDATE weather_hero_awards SET used_meetup_id = (SELECT id FROM meetups LIMIT 1), "
            "used_at = '2026-11-19' WHERE id = ("
            "SELECT MIN(a.id) FROM weather_hero_awards a JOIN users u ON u.id = a.user_id "
            "WHERE u.historical_roster_name = 'Alex Example' AND a.import_source = ?)",
            (AWARD_SOURCE,),
        )
    tokens["Alex Example"] = 3
    assert await import_workbook(database, ratings, tokens, nights, expected, {}) == []
    with sqlite3.connect(database) as db:
        assert db.execute(
            "SELECT import_source, COUNT(*), SUM(used_at IS NOT NULL), "
            "SUM(granted_meetup_id IS NOT NULL) FROM weather_hero_awards a "
            "JOIN users u ON u.id = a.user_id WHERE u.historical_roster_name = 'Alex Example' "
            "GROUP BY import_source ORDER BY import_source"
        ).fetchall() == [(None, 1, 0, 1), (AWARD_SOURCE, 3, 1, 0)]
    with sqlite3.connect(database) as db:
        before = list(db.iterdump())

    assert await import_workbook(database, ratings, tokens, nights, expected, {}) == []
    with sqlite3.connect(database) as db:
        assert list(db.iterdump()) == before
    with pytest.raises(ValueError, match="existing Pocket ID link"):
        await import_workbook(
            database, ratings, tokens, nights, expected, {"Alex Example": str(UUID(int=2))}
        )
    with sqlite3.connect(database) as db:
        assert list(db.iterdump()) == before


@pytest.mark.parametrize("value", [-1, 1.5, "1", True, float("nan"), float("inf")])
def test_roster_tokens_must_be_nonnegative_whole_numbers(value):
    workbook = {
        "Roster": Sheet(
            [ROSTER_COLUMNS, ("Alex Example", 1, None, None, None, None, None, value)]
        )
    }
    with pytest.raises(
        ValueError, match="Roster row 2 Tokens: expected a nonnegative whole number"
    ):
        parse_workbook(workbook)
