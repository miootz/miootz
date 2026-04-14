from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "Footy Legends API"
    DATABASE_URL: str = "sqlite+aiosqlite:///./data/footy.db"
    SECRET_KEY: str
    MAILGUN_API_KEY: str
    MAILGUN_DOMAIN: str
    AUTHELIA_TRUSTED_HEADER: str = "Remote-User"

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
