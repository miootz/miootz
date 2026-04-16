import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import invites, session_links, sessions, sms_auth, ratings, users_stats, users
from app.api.middleware import AutheliaAuthMiddleware
from app.core.config import settings
from app.core.database import Base, engine, init_db
from app.core.migrations import run_sqlite_migrations
from app.services.scheduler_setup import shutdown_scheduler, start_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await run_sqlite_migrations(conn)

    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    start_scheduler()
    yield
    shutdown_scheduler()


app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan)

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

app.add_middleware(AutheliaAuthMiddleware)

app.include_router(invites.router)
app.include_router(sessions.router)
app.include_router(session_links.router)
app.include_router(users.router)
app.include_router(sms_auth.router)
app.include_router(ratings.router)
app.include_router(users_stats.router)

os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
app.mount(
    "/uploads",
    StaticFiles(directory=settings.UPLOAD_DIR),
    name="uploads",
)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


@app.get("/me")
async def get_me(request: Request):
    if not request.state.user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {
        "user": request.state.user,
        "is_admin": getattr(request.state, "is_admin", False),
        "auth_groups": getattr(request.state, "auth_groups", []),
    }
