"""Per-client rate limiting (slowapi).

Keyed by authenticated user id when the auth middleware resolved one,
otherwise by client IP. The app runs behind Traefik, so the real client
address comes from the first `X-Forwarded-For` hop (set by Traefik's default
`XForwarded` behavior); `request.client.host` alone would be the shared
Docker gateway IP for every browser.

Storage is slowapi's default in-memory sliding window: per-process state,
which is correct for the single-uvicorn-worker deployment. If uvicorn ever
runs multiple workers, move the Limiter to a Redis-backed
`limits.storage.RedisStorage`.

Endpoints that are anonymous-by-design (plus-one claim routes) or that hit
third-party services (weather refresh) carry tighter limits than plain
authenticated traffic. SSE streams count each *connect* as one request;
generous limits there catch reconnect storms without breaking normal use.
"""

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def client_key(request: Request) -> str:
    """Rate-limit bucket key: user id when authed, else first XFF hop / socket IP."""
    user = getattr(request.state, "user", None)
    if user is not None:
        return f"user:{user.id}"
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return f"ip:{forwarded.split(',')[0].strip()}"
    return f"ip:{get_remote_address(request)}"


#: Limits used by @limiter.limit(...) on the sensitive endpoints.
LIMIT_PUBLIC = "30 per minute"  # anonymous token-capability GETs (claim preview)
LIMIT_MUTATION = "10 per minute"  # anonymous claim POST, plus-one add
LIMIT_WRITE = "20 per minute"  # authed cancels / outbound-service refreshes
LIMIT_SSE = "30 per minute"  # stream connects (catches reconnect storms)

limiter = Limiter(key_func=client_key)
