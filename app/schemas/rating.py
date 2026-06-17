from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class RatingCreate(BaseModel):
    session_id: int
    ratee_id: int
    score: int = Field(..., ge=1, le=5)


class RatingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    ratee_id: int
    score: int
    created_at: datetime
    updated_at: datetime


class RateeContext(BaseModel):
    user_id: int
    display_name: str
    avatar_url: str | None = None
    my_score: int | None = None


class RatingContextResponse(BaseModel):
    session_id: int
    session_start_time: datetime
    session_end_time: datetime
    before_session_end: bool
    ratings_locked: bool
    ratings_editable: bool
    ratings_lock_at: str | None = None
    viewer_attended: bool
    ratees: list[RateeContext]
