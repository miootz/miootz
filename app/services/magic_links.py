import time
from typing import Any

from itsdangerous import BadSignature, URLSafeSerializer

from app.core.config import settings

_serializer = URLSafeSerializer(settings.SECRET_KEY, salt="miootz-session-actions")


def sign_action_token(
    session_id: int,
    user_id: int,
    action: str,
    expires_at_ts: float,
) -> str:
    payload = {
        "sid": session_id,
        "uid": user_id,
        "act": action,
        "exp": expires_at_ts,
    }
    return _serializer.dumps(payload)


def verify_action_token(token: str) -> dict[str, Any]:
    try:
        data = _serializer.loads(token)
    except BadSignature as e:
        raise ValueError("Invalid link") from e

    if time.time() > float(data["exp"]):
        raise ValueError("This link is no longer valid (session has started)")
    return data
