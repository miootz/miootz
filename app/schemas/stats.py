from pydantic import BaseModel


class UserStats(BaseModel):
    games_played: int
    season_games: int
    average_rating: float
    total_ratings: int
    skill_level: float


class MatchScoreReport(BaseModel):
    session_id: int
    player_id: int
    score: int  # 1-5
    type: str  # 'team' or 'individual'
