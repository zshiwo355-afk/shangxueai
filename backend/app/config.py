from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[1]
BACKEND_ENV_FILE = BACKEND_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_ENV_FILE,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        env_ignore_empty=True,
    )

    # ---- MaxKB ----
    maxkb_base_url: str = Field(..., alias="MAXKB_BASE_URL")
    maxkb_api_key: str = Field("", alias="MAXKB_API_KEY")
    maxkb_admin_base_url: str | None = Field(default=None, alias="MAXKB_ADMIN_BASE_URL")
    maxkb_system_api_key: str | None = Field(default=None, alias="MAXKB_SYSTEM_API_KEY")
    maxkb_admin_username: str | None = Field(default=None, alias="MAXKB_ADMIN_USERNAME")
    maxkb_admin_password: str | None = Field(default=None, alias="MAXKB_ADMIN_PASSWORD")
    maxkb_workspace_id: str = Field("default", alias="MAXKB_WORKSPACE_ID")
    maxkb_kb_id: str = Field("", alias="MAXKB_KB_ID")
    maxkb_timeout_seconds: int = Field(60, alias="MAXKB_TIMEOUT_SECONDS")
    maxkb_rule_top_k: int = Field(8, alias="MAXKB_RULE_TOP_K")
    maxkb_rule_similarity: float = Field(0.3, alias="MAXKB_RULE_SIMILARITY")
    maxkb_knowledge_top_k: int = Field(12, alias="MAXKB_KNOWLEDGE_TOP_K")
    maxkb_knowledge_similarity: float = Field(0.3, alias="MAXKB_KNOWLEDGE_SIMILARITY")

    # ---- LLM ----
    llm_base_url: str = Field("https://api.ofox.ai/v1", alias="LLM_BASE_URL")
    llm_api_key: str = Field("", alias="LLM_API_KEY")
    llm_model: str = Field("openai/gpt-4o", alias="LLM_MODEL")
    llm_timeout_seconds: int = Field(120, alias="LLM_TIMEOUT_SECONDS")
    llm_max_output_tokens: int = Field(4000, alias="LLM_MAX_OUTPUT_TOKENS")

    # ---- CORS ----
    allowed_origins: str = Field(
        "http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:5173,http://localhost:5173",
        alias="ALLOWED_ORIGINS",
    )
    allowed_origin_regex: str = Field(
        r"^(https?://(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?)$",
        alias="ALLOWED_ORIGIN_REGEX",
    )

    # ---- 工程硬校验 ----
    min_rounds: int = Field(10, alias="MIN_ROUNDS")

    # ---- 数据库（MySQL）----
    db_dsn: str = Field(
        "mysql+aiomysql://root:123@127.0.0.1:3306/shangxueai?charset=utf8mb4",
        alias="DB_DSN",
    )
    db_echo: bool = Field(False, alias="DB_ECHO")
    db_pool_size: int = Field(10, alias="DB_POOL_SIZE")
    db_pool_recycle_seconds: int = Field(1800, alias="DB_POOL_RECYCLE_SECONDS")

    # ---- 鉴权（JWT，密码 MD5）----
    auth_enabled: bool = Field(True, alias="AUTH_ENABLED")
    jwt_secret: str = Field("change-me-in-production-shangxueai", alias="JWT_SECRET")
    jwt_algorithm: str = Field("HS256", alias="JWT_ALGORITHM")
    jwt_ttl_hours: int = Field(720, alias="JWT_TTL_HOURS")  # 30 天
    super_admin_username: str = Field("", alias="SUPER_ADMIN_USERNAME")
    super_admin_password: str = Field("", alias="SUPER_ADMIN_PASSWORD")
    super_admin_name: str = Field("", alias="SUPER_ADMIN_NAME")

    # ---- 阿里云 OSS（魔学院视频）----
    oss_access_key_id: str = Field("", alias="OSS_ACCESS_KEY_ID")
    oss_access_key_secret: str = Field("", alias="OSS_ACCESS_KEY_SECRET")
    oss_endpoint: str = Field("", alias="OSS_ENDPOINT")
    oss_bucket: str = Field("", alias="OSS_BUCKET")
    oss_public_base_url: str = Field("", alias="OSS_PUBLIC_BASE_URL")
    oss_upload_prefix: str = Field("", alias="OSS_UPLOAD_PREFIX")
    oss_signed_url_expire_seconds: int = Field(3600, alias="OSS_SIGNED_URL_EXPIRE_SECONDS")
    magic_video_max_size_mb: int = Field(10240, alias="MAGIC_VIDEO_MAX_SIZE_MB")

    _UUID_TAIL = re.compile(
        r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    )

    @property
    def maxkb_origin_url(self) -> str:
        parsed = urlparse(self.maxkb_base_url)
        return f"{parsed.scheme}://{parsed.netloc}"

    @property
    def maxkb_admin_api_url(self) -> str:
        if self.maxkb_admin_base_url:
            return self.maxkb_admin_base_url.rstrip("/")
        return f"{self.maxkb_origin_url}/admin/api"

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
