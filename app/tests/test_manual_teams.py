"""Unit tests for manual team partition validation."""

from app.services.manual_teams import validate_team_partition


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
