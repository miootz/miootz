from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "Miootz API"
    DATABASE_URL: str = "sqlite+aiosqlite:///./data/miootz.db"
    #: Separate SQLite database for the audit log (pruned independently of game data)
    AUDIT_DATABASE_URL: str = "sqlite+aiosqlite:///./data/audit.db"
    #: Audit rows older than this are pruned by the hourly job
    AUDIT_RETENTION_DAYS: int = 90

    # Optional: restrict Host header (comma-separated). Empty = disabled.
    TRUSTED_HOSTS: str = ""

    # Comma-separated allowed origins for CORS (browser clients). Empty = no CORS middleware.
    CORS_ORIGINS: str = ""

    # Public app URL for links in push notifications (no trailing slash).
    PUBLIC_APP_URL: str = "http://localhost:5173"

    # Web Push (VAPID) — optional; leave empty to disable browser push subscriptions
    # See .env.example for setup.
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    #: Contact for push (e.g. mailto:admin@example.com)
    VAPID_SUBJECT: str = "mailto:noreply@localhost"
    #: Host suffix allowlist for user-supplied push endpoints (the server POSTs
    #: to them). Comma-separated; a leading `.` matches subdomains. Override to
    #: add self-hosted push services (e.g. Red Push).
    PUSH_ENDPOINT_HOSTS: str = (
        "fcm.googleapis.com,fcm.x.io,api.push.apple.com,.moeapp.net,.up.pushin.ca"
    )

    # APScheduler default timezone (per-rule recurrence jobs use their own announce_timezone)
    SCHEDULER_ENABLED: bool = True
    SCHEDULER_TIMEZONE: str = "UTC"

    # --- Pocket ID OIDC ---
    #: Pocket ID OIDC issuer URL (e.g. https://auth.miootz.local)
    POCKET_ID_OIDC_ISSUER: str = ""
    #: OIDC client ID registered in Pocket ID (e.g. miootz-app)
    POCKET_ID_OIDC_CLIENT_ID: str = ""

    # --- Pocket ID admin API (for signup tokens) ---
    #: Internal URL for Pocket ID (Docker: http://pocket-id:1411)
    POCKET_ID_INTERNAL_URL: str = ""
    #: Public URL for Pocket ID (e.g. https://auth.miootz.local)
    POCKET_ID_APP_URL: str = ""
    #: Static API key for Pocket ID (set via STATIC_API_KEY env var in Pocket ID)
    POCKET_ID_STATIC_API_KEY: str = ""
    #: Admin API key for Pocket ID (JWT-based, optional — falls back to STATIC_API_KEY)
    POCKET_ID_API_KEY: str = ""
    #: Pocket ID group UUID for the "members" group (assigned to new signups)
    POCKET_ID_MEMBERS_GROUP_ID: str = ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
