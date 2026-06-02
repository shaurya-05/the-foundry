import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    STRIPE_WEBHOOK_SECRET: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
