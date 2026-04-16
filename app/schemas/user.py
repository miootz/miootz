from pydantic import BaseModel, Field
from typing import Optional


class UserProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    skill_level: Optional[int] = Field(None, ge=1, le=5)
