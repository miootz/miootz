from pydantic import BaseModel


class UserStats(BaseModel):
    games_played: int
    season_games: int
    average_rating: float
    total_ratings: int
    skill_level: float
    goals: int = 0
    assists: int = 0
    clean_sheets: int = 0
    goals_conceded: int = 0
    wins: int = 0
    matches: int = 0
    win_rate: float = 0.0
    season_goals: int = 0
    season_assists: int = 0
    season_clean_sheets: int = 0
    season_goals_conceded: int = 0
    season_wins: int = 0
    season_matches: int = 0
    season_win_rate: float = 0.0


class MatchScoreReport(BaseModel):
    meetup_id: int
    player_id: int
    score: int  # 1-5
    type: str  # 'team' or 'individual'
