from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "Footy Legends API"
    DATABASE_URL: str = "sqlite+aiosqlite:///./data/footy.db"
    SECRET_KEY: str
    MAILGUN_API_KEY: str = ""
    MAILGUN_DOMAIN: str = ""
    MAIL_FROM: str = "Footy Legends <noreply@localhost>"
    UPLOAD_DIR: str = "./data/uploads"
    SMS_GATEWAY_MOCK: bool = True

    # --- Authelia / reverse-proxy (Traefik forward-auth) ---
    # Headers injected by Authelia after successful forward-auth (Trusted Header SSO).
    AUTHELIA_USER_HEADER: str = Field(
        default="Remote-User",
        validation_alias=AliasChoices("AUTHELIA_USER_HEADER", "AUTHELIA_TRUSTED_HEADER"),
    )
    AUTHELIA_GROUPS_HEADER: str = "Remote-Groups"
    AUTHELIA_NAME_HEADER: str = "Remote-Name"
    AUTHELIA_EMAIL_HEADER: str = "Remote-Email"

    # Comma-separated Authelia group names that grant admin for this app (in addition to User.is_admin).
    AUTH_ADMIN_GROUPS: str = "admins,admin"

    # When True, only trust identity headers if the request looks like it came through a reverse proxy
    # (X-Forwarded-For or Forwarded). Set True in production behind Traefik. Keep False for local uvicorn/tests.
    AUTH_REQUIRE_FORWARDED_HEADERS: bool = False

    # Optional: restrict Host header (comma-separated). Empty = disabled.
    TRUSTED_HOSTS: str = ""

    # Comma-separated allowed origins for CORS (browser clients). Empty = no CORS middleware.
    CORS_ORIGINS: str = ""

    # Public URL for magic links in emails (no trailing slash)
    PUBLIC_APP_URL: str = "http://localhost:8000"

    # Gotify push (optional — leave empty to skip)
    GOTIFY_URL: str = ""
    GOTIFY_APP_TOKEN: str = ""

    # Tuesday 12:00 reminder job (APScheduler uses this timezone)
    SCHEDULER_ENABLED: bool = True
    SCHEDULER_TIMEZONE: str = "UTC"
    REMINDER_WEEKDAY: int = 1  # Monday=0 .. Sunday=6 → 1 = Tuesday
    REMINDER_HOUR: int = 12
    REMINDER_MINUTE: int = 0

    # Optional: append invited users as YAML snippets for manual Authelia merge
    AUTHELIA_USERS_YML_PATH: str = ""

    model_config = SettingsConfigDict(env_file=".env")

    @property
    def admin_group_names(self) -> set[str]:
        return {g.strip().lower() for g in self.AUTH_ADMIN_GROUPS.split(",") if g.strip()}


settings = Settings()
