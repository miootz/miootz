from pydantic import BaseModel


class RankingUser(BaseModel):
    id: int
    display_name: str
    avatar_url: str | None = None


class RankingRow(BaseModel):
    rank: int
    user: RankingUser
    attendances: int
    goals: int
    assists: int
    clean_sheets: int
    goals_conceded: int
    wins: int
    matches: int
    win_rate: float
    goal_assists: int


class HighlightEntry(BaseModel):
    name: str
    value: str | int


class TeamRosterUser(BaseModel):
    id: int
    display_name: str


class TeamNightRecord(BaseModel):
    name: str
    wins: int
    matches: int
    goals_for: int
    goals_against: int
    goal_diff: int
    clean_sheets: int
    roster: list[TeamRosterUser] = []


class NightKpis(BaseModel):
    matches: int
    goals: int
    players: int
    one_goal_wins: int
    draws: int


class NightStats(BaseModel):
    kpis: NightKpis
    teams: list[TeamNightRecord] = []


class RankingsResponse(BaseModel):
    #: Selected season; null = all time (or the per-meetup scope).
    year: int | None = None
    #: Calendar years that have confirmed attendance (for season navigation).
    available_years: list[int] | None = None
    page: int = 1
    per_page: int = 25
    total: int = 0
    #: Per-meetup night stats; present only for the meetup-scoped endpoint.
    night: NightStats | None = None
    #: Top-3 per category over the full in-scope set (season/all-time views).
    highlights: dict[str, list[HighlightEntry]] | None = None
    rows: list[RankingRow] = []
