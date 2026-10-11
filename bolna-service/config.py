from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Loads provider configuration from the repository environment file."""

    cloudflare_account_id: str
    cloudflare_api_token: str
    cloudflare_ai_model: str
    cloudflare_stt_model: str
    cartesia_api_key: str
    cartesia_model_id: str
    cartesia_voice_id: str

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env",
        extra="ignore",
        case_sensitive=False,
    )


settings = Settings()
