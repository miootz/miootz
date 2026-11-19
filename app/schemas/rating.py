from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class RatingCreate(BaseModel):
    meetup_id: int
    ratee_id: int
    score: float = Field(..., ge=0, le=5, multiple_of=0.5, description="Use 0 to clear or skip a rating.")

    @field_validator("score")
    @classmethod
    def valid_rating(cls, value: float) -> float:
        if 0 < value < 1:
            raise ValueError("Rating must be at least 1 star")
        return value


class RatingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    meetup_id: int
    ratee_id: int
    score: float
    created_at: datetime
    updated_at: datetime


class RateeContext(BaseModel):
    user_id: int
    display_name: str
    avatar_url: str | None = None
    my_score: float | None = None


class RatingContextResponse(BaseModel):
    peer_rating_mode: Literal["off", "teammates-only", "everyone"] = "everyone"
    meetup_id: int
    meetup_start_time: datetime
    meetup_end_time: datetime
    before_meetup_end: bool
    ratings_locked: bool
    ratings_editable: bool
    ratings_lock_at: str | None = None
    viewer_attended: bool
    ratees: list[RateeContext]
