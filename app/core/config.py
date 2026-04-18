from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "Footy Legends API"
    DATABASE_URL: str = "sqlite+aiosqlite:///./data/footy.db"
    SECRET_KEY: str
    MAILGUN_API_KEY: str = ""
    MAILGUN_DOMAIN: str = ""
    MAIL_FROM: str = "Footy Legends <noreply@localhost>"

    # SMTP (invite emails, etc.). Mailhog dev: SMTP_HOST=localhost SMTP_PORT=1025
    SMTP_HOST: str = ""
    SMTP_PORT: int = 1025
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = False
    SMTP_STARTTLS: bool = False
    #: From address for SMTP sends (can match MAIL_FROM).
    SMTP_FROM: str = ""
    UPLOAD_DIR: str = "./data/uploads"
    MAX_AVATAR_BYTES: int = 2 * 1024 * 1024
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

    # Public URL for magic links in emails (no trailing slash). Local dev: Vite dev server.
    PUBLIC_APP_URL: str = "http://localhost:5173"

    # Web Push (VAPID) — optional; leave empty to disable browser push subscriptions
    # Generate keys: `python -c "from py_vapid import Vapid; v=Vapid(); v.generate_keys(); print(v.public_key); print(v.private_key)"` (see py-vapid docs)
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    #: Contact for push (e.g. mailto:admin@example.com)
    VAPID_SUBJECT: str = "mailto:noreply@localhost"

    # APScheduler default timezone (per-rule recurrence jobs use their own announce_timezone)
    SCHEDULER_ENABLED: bool = True
    SCHEDULER_TIMEZONE: str = "UTC"

    #: Optional comma-separated LDAP group CNs (under ou=groups) for invited users (default: members).
    AUTHELIA_INVITE_DEFAULT_GROUPS: str = ""
    #: Alias for AUTHELIA_INVITE_DEFAULT_GROUPS (comma-separated group CNs).
    LDAP_INVITE_GROUP_CNS: str = ""

    # OpenLDAP — invite verification provisions inetOrgPerson entries (real-time auth; no file refresh delay).
    LDAP_URI: str = ""
    LDAP_BASE_DN: str = ""
    LDAP_BIND_DN: str = ""
    LDAP_BIND_PASSWORD: str = ""
    #: RDN under base_dn for users, e.g. ou=people
    LDAP_USERS_OU: str = "ou=people"
    #: RDN under base_dn for groups, e.g. ou=groups
    LDAP_GROUPS_OU: str = "ou=groups"
    #: Link shown in welcome email (Authelia login portal). Empty = omitted from template.
    AUTH_PORTAL_URL: str = ""
    #: Base URL for server-side Authelia API calls (invite completion → first factor). Docker: http://authelia:9091
    AUTHELIA_INTERNAL_URL: str = ""

    model_config = SettingsConfigDict(env_file=".env")

    @property
    def admin_group_names(self) -> set[str]:
        return {g.strip().lower() for g in self.AUTH_ADMIN_GROUPS.split(",") if g.strip()}

    @property
    def smtp_from_address(self) -> str:
        return (self.SMTP_FROM or self.MAIL_FROM).strip() or "Footy Legends <noreply@localhost>"


settings = Settings()
