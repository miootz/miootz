from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

SPECIALTY_OPTIONS = Literal["ATT", "MID", "DEF", "GK"]


class UserMe(BaseModel):
    """User identity + app-specific profile data."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    pocket_id_sub: str
    #: Display name from Pocket ID (sso_display_name)
    display_name: str | None = None
    #: Pocket ID avatar URL (computed from pocket_id_sub)
    avatar_url: str | None = None
    self_assessed_skill: int | None = None
    calculated_skill: float | None = None
    primary_specialty: SPECIALTY_OPTIONS | None = None
    secondary_specialty: SPECIALTY_OPTIONS | None = None
    is_admin: bool = False


class UserProfileUpdate(BaseModel):
    """User-editable profile fields (identity is managed by Pocket ID)."""
    self_assessed_skill: Optional[int] = Field(None, ge=1, le=5)
    primary_specialty: Optional[SPECIALTY_OPTIONS] = None
    secondary_specialty: Optional[SPECIALTY_OPTIONS] = None
