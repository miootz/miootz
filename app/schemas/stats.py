from pydantic import BaseModel, Field


class AttributeEvidence(BaseModel):
    score: float | None
    overridden: bool = False
    count: int
    sample: int
    meetups: int


class PassingEvidence(AttributeEvidence):
    total_goals: int


class PlayerAttributes(BaseModel):
    sho: AttributeEvidence
    pas: PassingEvidence
    def_: AttributeEvidence = Field(alias="def")
    pac: float | None
    dri: float | None


class UserStats(BaseModel):
    games_played: int
    season_games: int
    average_rating: float
    total_ratings: int
    skill_level: float
    computed_scores: bool = True
    base_rating: float | None = None
    adjusted_rating: float | None = None
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
    season_losses: int = 0
    season_matches: int = 0
    season_win_rate: float = 0.0
    season_goal_assists_per_match: float = 0.0
    season_penalties_taken: int = 0
    season_penalties_scored: int = 0
    season_penalty_conversion_rate: float = 0.0
    weather_hero_unused: int = 0
    attributes: PlayerAttributes | None = None


class MatchScoreReport(BaseModel):
    meetup_id: int
    player_id: int
    score: int  # 1-5
    type: str  # 'team' or 'individual'
