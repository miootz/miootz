import pytest
from app.services.matchmaking.service import MatchmakingService


@pytest.fixture
def matchmaking_service():
    return MatchmakingService()


def test_balance_teams_accuracy(matchmaking_service):
    """
    Verify the algorithm splits players with extreme skill gaps evenly.
    """
    players = [
        {"id": 1, "skill": 10},
        {"id": 2, "skill": 9},
        {"id": 3, "skill": 2},
        {"id": 4, "skill": 1},
    ]
    # Expect 2 teams of 2
    teams = matchmaking_service.balance_teams(players, team_size=2)

    assert len(teams) == 2
    assert len(teams[0]) == 2
    assert len(teams[1]) == 2

    # Team 0 should have 10 and 1 (avg 5.5)
    # Team 1 should have 9 and 2 (avg 5.5)
    # Or similar balanced distribution
    skill_sum_0 = sum(p["skill"] for p in teams[0])
    skill_sum_1 = sum(p["skill"] for p in teams[1])

    assert abs(skill_sum_0 - skill_sum_1) <= 1


def test_balance_teams_non_divisible(matchmaking_service):
    """
    Verify behavior when total players are not perfectly divisible by team_size.
    """
    players = [
        {"id": 1, "skill": 10},
        {"id": 2, "skill": 8},
        {"id": 3, "skill": 6},
        {"id": 4, "skill": 4},
        {"id": 5, "skill": 2},
    ]
    # team_size = 2. 5 players -> 3 teams.
    # Teams might be sizes [2, 2, 1]
    teams = matchmaking_service.balance_teams(players, team_size=2)

    assert len(teams) == 3
    total_players_in_teams = sum(len(team) for team in teams)
    assert total_players_in_teams == 5


def test_empty_players(matchmaking_service):
    assert matchmaking_service.balance_teams([], 2) == []


def test_extreme_unbalance(matchmaking_service):
    # All same skill
    players = [{"id": i, "skill": 5} for i in range(4)]
    teams = matchmaking_service.balance_teams(players, team_size=2)
    assert len(teams) == 2
    assert len(teams[0]) == 2
    assert len(teams[1]) == 2
