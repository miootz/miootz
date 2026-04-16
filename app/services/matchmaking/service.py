from typing import List, Dict, Any


class MatchmakingService:
    """
    Service for handling skill-based team assignment.
    """

    def balance_teams(
        self, players: List[Dict[str, Any]], team_size: int
    ) -> List[List[Dict[str, Any]]]:
        """
        Distributes players to minimize variance in average team skill.

        Args:
            players: List of player dictionaries. Each player should have a 'skill' key.
            team_size: Desired number of players per team.

        Returns:
            A list of teams, where each team is a list of players.
        """
        if not players:
            return []

        # Sort players by skill descending to use a snake-style distribution
        sorted_players = sorted(players, key=lambda x: x["skill"], reverse=True)

        # Calculate number of teams
        # If players = 10, team_size = 5 -> 2 teams
        # If players = 11, team_size = 5 -> 3 teams (one with 1)
        # Wait, the requirement says "minimize variance".
        # Usually, we want roughly equal team sizes.

        num_teams = (len(sorted_players) + team_size - 1) // team_size
        if num_teams == 0:
            return []

        teams: List[List[Dict[str, Any]]] = [[] for _ in range(num_teams)]

        # Distribute players using a snake/zigzag pattern to ensure
        # high and low skills are balanced.
        # Example: 2 teams, 4 players (skills 4,3,2,1)
        # Team 0: 4, 1
        # Team 1: 3, 2

        for i, player in enumerate(sorted_players):
            # Determine which team to assign the player to
            # Using a modulo approach with snake pattern:
            # Round 0: 0, 1, 2...
            # Round 1: ...2, 1, 0

            round_idx = i // num_teams
            pos_in_round = i % num_teams

            if round_idx % 2 == 0:
                team_idx = pos_in_round
            else:
                team_idx = (num_teams - 1) - pos_in_round

            teams[team_idx].append(player)

        return teams
