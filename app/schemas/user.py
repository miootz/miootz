from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class SSOIdentity(BaseModel):
    username: str | None = None
    email: str | None = None
    display_name: str | None = None


class UserMe(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: str
    full_name: str | None = None
    phone: str | None = None
    profile_pic: str | None = None
    skill_level: int | None = None
    self_assessed_skill: int | None = None
    calculated_skill: int | None = None
    is_admin: bool = False


class UserProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    skill_level: Optional[int] = Field(None, ge=1, le=5)
    self_assessed_skill: Optional[int] = Field(None, ge=1, le=5)
    sync_display_name_from_sso: bool = False
    sync_email_from_sso: bool = False
