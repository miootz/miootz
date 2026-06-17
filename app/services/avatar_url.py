"""Compute Pocket ID avatar URLs."""

from app.core.config import settings


def get_avatar_url(pocket_id_sub: str | None) -> str | None:
    """Build the Pocket ID profile-picture URL for a user.

    Returns None if the user has no Pocket ID link.
    """
    if not pocket_id_sub:
        return None
    base = (settings.POCKET_ID_APP_URL or "").rstrip("/")
    if not base:
        return None
    return f"{base}/api/users/{pocket_id_sub}/profile-picture.png"
