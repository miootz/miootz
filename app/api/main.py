from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

from app.api import (
    game_templates,
    invites,
    matches,
    sessions,
    ratings,
    users_stats,
    users,
)
from app.api.middleware import PocketIdAuthMiddleware
from app.api.rate_limit import limiter
from app.core.config import settings
from app.core.database import Base, engine, init_db
from app.models import game_template  # noqa: F401 — GameTemplate + GameSession FK
from app.models import game_template_subscription  # noqa: F401
from app.models import match  # noqa: F401 — SessionMatch
from app.models import match_editor_lease  # noqa: F401 — MatchEditorLease
from app.models import match_goal  # noqa: F401 — MatchGoal
from app.models import web_push_subscription  # noqa: F401
from app.models import user_notification_preference  # noqa: F401
from app.core.migrations import run_sqlite_migrations
from app.services.recurrence_scheduler import sync_game_template_jobs_from_db
from app.services.scheduler_setup import shutdown_scheduler, start_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await run_sqlite_migrations(conn)

    # Pre-fetch Pocket ID JWKS so the first auth request isn't blocked
    try:
        from app.services.pocket_id_jwt import _fetch_jwks

        await _fetch_jwks()
    except Exception:
        pass  # non-fatal — will be retried on first auth request

    start_scheduler()
    await sync_game_template_jobs_from_db()
    yield
    shutdown_scheduler()


app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan)

# Rate limiting (slowapi, in-memory per-process store; single uvicorn worker).
app.state.limiter = limiter


async def _handle_rate_limit(request: Request, exc: Exception) -> JSONResponse:
    """429 with the same JSON shape as FastAPI HTTPException details.

    Typed as (Request, Exception) to satisfy Starlette's ExceptionHandler
    union (slowapi's own handler is typed too narrowly for it).
    """
    detail = getattr(exc, "detail", None) or "Rate limit exceeded"
    return JSONResponse(status_code=429, content={"detail": detail})


app.add_exception_handler(RateLimitExceeded, _handle_rate_limit)

_cors = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
if _cors:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

_hosts = [h.strip() for h in settings.TRUSTED_HOSTS.split(",") if h.strip()]
if _hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=_hosts)

app.add_middleware(PocketIdAuthMiddleware)

app.include_router(invites.router)
app.include_router(game_templates.router)
app.include_router(sessions.router)
app.include_router(matches.router)
app.include_router(users.router)
app.include_router(ratings.router)
app.include_router(users_stats.router)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.get("/me")
async def get_me(request: Request):
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = request.state.user
    return {
        "user": {
            "id": user.id,
            "pocket_id_sub": user.pocket_id_sub,
            "display_name": getattr(request.state, "sso_display_name", None),
            "avatar_url": user.avatar_url,
            "self_assessed_skill": user.self_assessed_skill,
            "calculated_skill": user.calculated_skill,
            "primary_specialty": user.primary_specialty,
            "secondary_specialty": user.secondary_specialty,
            "is_admin": getattr(request.state, "is_admin", False),
        },
        "is_admin": getattr(request.state, "is_admin", False),
        "auth_groups": getattr(request.state, "auth_groups", []),
    }
