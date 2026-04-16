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
