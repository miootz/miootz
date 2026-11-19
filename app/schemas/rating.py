from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.rating import PeerReview


class RatingCreate(BaseModel):
    meetup_id: int
    ratee_id: int
    review: PeerReview | None = Field(None, description="Use null to clear a review.")
    score: float | None = Field(None, ge=0, le=5, multiple_of=0.5, description="Legacy star vote. Use 0 to clear it.")

    @field_validator("score")
    @classmethod
    def valid_rating(cls, value: float | None) -> float | None:
        if value is None or 0 < value < 1:
            raise ValueError("Rating must be at least 1 star")
        return value

    @model_validator(mode="after")
    def one_rating_format(self):
        if len(self.model_fields_set & {"score", "review"}) != 1:
            raise ValueError("Provide either a peer review or a star rating")
        return self


class RatingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    meetup_id: int
    ratee_id: int
    score: float
    review: PeerReview | None
    created_at: datetime
    updated_at: datetime


class RateeContext(BaseModel):
    user_id: int
    display_name: str
    avatar_url: str | None = None
    my_score: float | None = None
    my_review: PeerReview | None = None


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
