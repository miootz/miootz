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


class RankingsResponse(BaseModel):
    #: Selected season; null = all time (or the per-meetup scope).
    year: int | None = None
    #: Calendar years that have confirmed attendance (for season navigation).
    available_years: list[int] | None = None
    page: int = 1
    per_page: int = 25
    total: int = 0
    rows: list[RankingRow] = []
