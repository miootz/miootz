"""Unit tests for manual team partition validation."""

from app.services.manual_teams import resolve_meetup_teams_nested, validate_team_partition
from app.services.team_assignment import (
    assign_teams_random,
    assign_teams_snake,
    rebalance_around_locked,
)


def test_validate_empty_roster():
    assert validate_team_partition([], set()) is True
    assert validate_team_partition([[]], {1}) is False


def test_validate_two_teams_four_players():
    confirmed = {1, 2, 3, 4}
    assert validate_team_partition([[1, 2], [3, 4]], confirmed) is True
    assert validate_team_partition([[1, 3], [2, 4]], confirmed) is True
    assert validate_team_partition([[1, 2, 3], [4]], confirmed) is False
    assert validate_team_partition([[1], [2, 3, 4]], confirmed) is False


def test_validate_duplicate_or_missing():
    assert validate_team_partition([[1, 1], [2, 3]], {1, 2, 3, 4}) is False
    assert validate_team_partition([[1, 2], [3]], {1, 2, 3, 4}) is False


def test_validate_three_teams_eleven_players():
    confirmed = set(range(1, 12))
    ok = [[1, 2, 3, 4], [5, 6, 7], [8, 9, 10, 11]]
    assert validate_team_partition(ok, confirmed) is True


def _players(n):
    # id str(i+1), skill descending: player 1 is the strongest
    return [{"id": str(i + 1), "skill": 10 - i} for i in range(n)]


def test_rebalance_locked_stay_put_partition_valid():
    players = _players(6)
    lineup = [[1, 2, 3], [4, 5, 6]]
    out = rebalance_around_locked(players, lineup, locked={1, 4})

    ids = [[int(p["id"]) for p in team] for team in out]
    # Locked players keep their teams and spots are preserved in size
    assert ids[0][0] == 1 and ids[1][0] == 4
    assert sorted(len(t) for t in ids) == [3, 3]
    # Rest of the confirmed roster, no duplicates
    assert sorted(uid for t in ids for uid in t) == [1, 2, 3, 4, 5, 6]


def test_rebalance_skill_snake_fills_remaining():
    players = _players(6)
    lineup = [[1, 2, 3], [4, 5, 6]]
    out = rebalance_around_locked(players, lineup, locked={1})

    ids = [[int(p["id"]) for p in team] for team in out]
    # Unlocked sorted by skill desc: 2,3,4,5,6 → snake into remaining
    # slots (team 0 has 2 left, team 1 has 3 left):
    # round 0: t0←2, t1←3 ; round 1 (reversed): t1←4, t0←5 ; round 2: t1←6
    assert ids[0] == [1, 2, 5]
    assert ids[1] == [3, 4, 6]


def test_rebalance_random_still_partitions():
    import random as _r

    _r.seed(7)
    players = _players(8)
    lineup = [[1, 2, 3, 4], [5, 6, 7, 8]]
    out = rebalance_around_locked(
        players, lineup, locked={2}, randomize=True
    )
    ids = sorted(uid for team in out for uid in (int(p["id"]) for p in team))
    assert ids == [1, 2, 3, 4, 5, 6, 7, 8]


def test_rebalance_distinct_skills_is_deterministic():
    import random as _r

    # All skills distinct → no equal-skill groups → one valid snake layout.
    players = [{"id": str(i + 1), "skill": 6 - i * 0.5} for i in range(6)]
    lineup = [[1, 2, 3], [4, 5, 6]]
    _r.seed(1)
    a = rebalance_around_locked(players, lineup, locked=set())
    _r.seed(2)
    b = rebalance_around_locked(players, lineup, locked=set())
    assert a == b


def test_rebalance_equal_skill_varies_layout_keeps_totals():
    import random as _r

    # Two players at each of three skill levels.
    players: list[dict] = []
    for s in (4.0, 3.0, 2.0):
        for _ in range(2):
            players.append({"id": str(len(players) + 1), "skill": s})
    lineup = [[1, 2, 3], [4, 5, 6]]

    def totals(out):
        return tuple(
            round(sum(float(p["skill"]) for p in players if int(p["id"]) in team), 3)
            for team in out
        )

    layouts: set[tuple] = set()
    reference: tuple | None = None
    for seed in range(15):
        _r.seed(seed)
        out = rebalance_around_locked(players, lineup, locked=set())
        ids = tuple(tuple(int(p["id"]) for p in team) for team in out)
        t = totals(out)
        assert sorted(uid for team in ids for uid in team) == [1, 2, 3, 4, 5, 6]
        reference = t if reference is None else reference
        assert t == reference  # equal-skill shuffle never moves a total
        layouts.add(ids)
    assert len(layouts) > 1  # …but it does produce new layouts


def test_balanced_draft_spreads_pace_and_dribbling_and_keeps_locked_players():
    # The first snake draft groups all three runners on one team and all
    # three technical players on the other.
    players = [
        {
            "id": str(i),
            "skill": 3.0,
            "pac": 4.0 if i in (1, 4, 5) else None,
            "dri": 4.0 if i in (2, 3, 6) else None,
        }
        for i in range(1, 7)
    ]
    teams = assign_teams_snake(players)
    for attribute in ("pac", "dri"):
        assert sorted(sum((p[attribute] or 3) > 3 for p in t) for t in teams) == [1, 2]

    teams = rebalance_around_locked(players, [[1, 4, 5], [2, 3, 6]], locked={1, 4})
    assert {p["id"] for p in teams[0]} >= {"1", "4"}
    assert sorted(len(team) for team in teams) == [3, 3]
    for attribute in ("pac", "dri"):
        assert sorted(sum((p[attribute] or 3) > 3 for p in t) for t in teams) == [1, 2]


def test_random_draft_does_not_rebalance_attributes(monkeypatch):
    monkeypatch.setattr("app.services.team_assignment.random.shuffle", lambda players: None)
    players = [
        {"id": str(i), "skill": 3.0, "pac": 4.0 if i in (1, 4, 5) else None}
        for i in range(1, 7)
    ]
    teams = assign_teams_random(players)
    assert [[p["id"] for p in team] for team in teams] == [["1", "4", "5"], ["2", "3", "6"]]


def test_auto_balanced_improves_snake_totals_and_is_stable():
    players = [
        {"id": str(i), "user_id": i, "skill": skill}
        for i, skill in enumerate((2.5, 1.5, 1.5, 1.5, 1, 1), 1)
    ]
    snake = resolve_meetup_teams_nested(None, "balanced", players)
    auto = resolve_meetup_teams_nested(None, "auto-balanced", players)
    assert [sum(p["skill"] for p in team) for team in snake] == [5.0, 4.0]
    assert [sum(p["skill"] for p in team) for team in auto] == [4.5, 4.5]
    assert auto == resolve_meetup_teams_nested(None, "auto-balanced", list(reversed(players)))


def test_auto_balanced_respects_locked_players_and_attribute_distribution():
    players = [
        {"id": str(i), "skill": skill, "pac": pace, "dri": dribbling}
        for i, (skill, pace, dribbling) in enumerate(
            ((4.5, 4, 3), (4, 3, 4), (3.5, 4, 3),
             (3, 3, 4), (2, 4, 3), (1, 3, 4)), 1
        )
    ]
    teams = rebalance_around_locked(
        players, [[1, 2, 3], [4, 5, 6]], locked={1, 4},
        optimize=True, shuffle_equal=False,
    )
    assert "1" in {p["id"] for p in teams[0]}
    assert "4" in {p["id"] for p in teams[1]}
    for attribute in ("pac", "dri"):
        assert sorted(sum(p[attribute] > 3 for p in team) for team in teams) == [1, 2]
