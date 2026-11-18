from datetime import datetime
import json
import sqlite3
from uuid import UUID

import pytest

from scripts.import_team_maker import (
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
                ("Name", "Rating"),
                ("Alex Example", 1),
                ("Casey Sample", 5),
                ("Jordan Fixture", 2),
                ("Taylor Mock", 3),
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
    ratings, nights, expected, warnings = parse_workbook(workbook)
    assert "matched 'Allex Example' to 'Alex Example'" in warnings[0]
    assert night_date(datetime(2024, 3, 19)).day == 12
    database = tmp_path / "miootz.db"
    subject = str(UUID(int=1))
    assert (
        await import_workbook(database, ratings, nights, expected, {"Alex Example": subject})
        == []
    )

    with sqlite3.connect(database) as db:
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
    with sqlite3.connect(database) as db:
        before = list(db.iterdump())

    assert await import_workbook(database, ratings, nights, expected, {}) == []
    with sqlite3.connect(database) as db:
        assert list(db.iterdump()) == before
    with pytest.raises(ValueError, match="existing Pocket ID link"):
        await import_workbook(
            database, ratings, nights, expected, {"Alex Example": str(UUID(int=2))}
        )
    with sqlite3.connect(database) as db:
        assert list(db.iterdump()) == before
