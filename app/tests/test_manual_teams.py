"""Unit tests for manual team partition validation."""

from app.services.manual_teams import validate_team_partition
from app.services.team_assignment import rebalance_around_locked


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
