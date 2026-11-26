from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    BRAND_NAME_EN: str = "EventLedger"
    BRAND_NAME_AR: str = "إيفنت ليدجر"
    ROOT_DOMAIN: str = "eventledger.local:3000"
    DATABASE_URL: str = "postgresql+asyncpg://venue_admin:venue_secret_password@localhost:5432/venue_erp_db"
    REDIS_URL: str = "redis://localhost:6379"
    JWT_SECRET: str = "change-this-to-a-64-char-random-secret"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 10080
    S3_ENDPOINT: str = "http://localhost:9000"
    S3_ACCESS_KEY: str = "minio_admin"
    S3_SECRET_KEY: str = "minio_secret_password"
    S3_BUCKET: str = "eventledger-assets"
    WHATSAPP_API_URL: str = "https://graph.facebook.com/v20.0"
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: str = "eventledger_wa_verify_token"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
