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
    llm_base_url: str = Field("https://api.ofox.io/v1", alias="LLM_BASE_URL")
    llm_api_key: str = Field("", alias="LLM_API_KEY")
    llm_model: str = Field("openai/gpt-4o", alias="LLM_MODEL")
    llm_timeout_seconds: int = Field(120, alias="LLM_TIMEOUT_SECONDS")
    llm_max_output_tokens: int = Field(4000, alias="LLM_MAX_OUTPUT_TOKENS")
    # ---- 录音转写：讯飞「录音文件转写大模型版」LFASR ----
    # 控制台 https://console.xfyun.cn/services/lfasr_llm
    asr_enabled: bool = Field(True, alias="ASR_ENABLED")
    asr_max_file_bytes: int = Field(500 * 1024 * 1024, alias="ASR_MAX_FILE_BYTES")
    asr_timeout_seconds: int = Field(60, alias="ASR_TIMEOUT_SECONDS")
    asr_poll_interval_seconds: int = Field(3, alias="ASR_POLL_INTERVAL_SECONDS")
    asr_poll_max_seconds: int = Field(300, alias="ASR_POLL_MAX_SECONDS")
    asr_language: str = Field("autodialect", alias="ASR_LANGUAGE")
    asr_role_type: int = Field(0, alias="ASR_ROLE_TYPE")
    xf_appid: str = Field("", alias="XF_APPID")
    xf_api_key: str = Field("", alias="XF_API_KEY")
    xf_api_secret: str = Field("", alias="XF_API_SECRET")
    image_gen_model: str = Field("openai/gpt-image-2", alias="IMAGE_GEN_MODEL")
    image_gen_size: str = Field("1536x1024", alias="IMAGE_GEN_SIZE")
    image_gen_quality: str = Field("low", alias="IMAGE_GEN_QUALITY")
    image_gen_timeout_seconds: int = Field(180, alias="IMAGE_GEN_TIMEOUT_SECONDS")

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
    db_pool_size: int = Field(30, alias="DB_POOL_SIZE")
    db_pool_max_overflow: int = Field(20, alias="DB_POOL_MAX_OVERFLOW")
    db_pool_recycle_seconds: int = Field(1800, alias="DB_POOL_RECYCLE_SECONDS")

    # ---- 鉴权（JWT，密码 MD5）----
    auth_enabled: bool = Field(True, alias="AUTH_ENABLED")
    jwt_secret: str = Field("change-me-in-production-shangxueai", alias="JWT_SECRET")
    jwt_algorithm: str = Field("HS256", alias="JWT_ALGORITHM")
    jwt_ttl_hours: int = Field(720, alias="JWT_TTL_HOURS")  # 30 天
    super_admin_username: str = Field("", alias="SUPER_ADMIN_USERNAME")
    super_admin_password: str = Field("", alias="SUPER_ADMIN_PASSWORD")
    super_admin_name: str = Field("", alias="SUPER_ADMIN_NAME")

    # ---- 企业微信 ----
    wecom_enabled: bool = Field(False, alias="WECOM_ENABLED")
    wecom_push_enabled: bool = Field(True, alias="WECOM_PUSH_ENABLED")
    wecom_login_enabled: bool = Field(True, alias="WECOM_LOGIN_ENABLED")
    wecom_sync_enabled: bool = Field(True, alias="WECOM_SYNC_ENABLED")
    wecom_corp_id: str = Field("", alias="WECOM_CORP_ID")
    wecom_agent_id: int = Field(0, alias="WECOM_AGENT_ID")
    wecom_app_secret: str = Field("", alias="WECOM_APP_SECRET")
    wecom_contact_secret: str = Field("", alias="WECOM_CONTACT_SECRET")
    wecom_redirect_uri: str = Field("", alias="WECOM_REDIRECT_URI")
    wecom_frontend_callback_url: str = Field("", alias="WECOM_FRONTEND_CALLBACK_URL")
    wecom_frontend_base_url: str = Field("", alias="WECOM_FRONTEND_BASE_URL")
    wecom_admin_userids: str = Field("", alias="WECOM_ADMIN_USERIDS")
    wecom_token_cache_seconds: int = Field(7000, alias="WECOM_TOKEN_CACHE_SECONDS")
    wecom_request_timeout_seconds: int = Field(10, alias="WECOM_REQUEST_TIMEOUT_SECONDS")
    wecom_sync_disabled_users: bool = Field(True, alias="WECOM_SYNC_DISABLED_USERS")
    wecom_auto_redirect_in_client: bool = Field(True, alias="WECOM_AUTO_REDIRECT_IN_CLIENT")
    wecom_state_ttl_seconds: int = Field(600, alias="WECOM_STATE_TTL_SECONDS")
    wecom_sync_protected_statuses: str = Field("试岗,离职", alias="WECOM_SYNC_PROTECTED_STATUSES")

    # ---- 微信公众号（公开 H5 分享卡片）----
    wechat_mp_enabled: bool = Field(False, alias="WECHAT_MP_ENABLED")
    wechat_mp_app_id: str = Field("", alias="WECHAT_MP_APP_ID")
    wechat_mp_app_secret: str = Field("", alias="WECHAT_MP_APP_SECRET")
    wechat_mp_token_cache_seconds: int = Field(7000, alias="WECHAT_MP_TOKEN_CACHE_SECONDS")
    wechat_mp_request_timeout_seconds: int = Field(10, alias="WECHAT_MP_REQUEST_TIMEOUT_SECONDS")

    # ---- 第三方员工通讯录同步 ----
    employee_sync_enabled: bool = Field(False, alias="EMPLOYEE_SYNC_ENABLED")
    employee_sync_base_url: str = Field("", alias="EMPLOYEE_SYNC_BASE_URL")
    employee_sync_app_id: str = Field("", alias="EMPLOYEE_SYNC_APP_ID")
    employee_sync_partner_private_key: str = Field("", alias="EMPLOYEE_SYNC_PARTNER_PRIVATE_KEY")
    employee_sync_hr_public_key: str = Field("", alias="EMPLOYEE_SYNC_HR_PUBLIC_KEY")
    employee_sync_timeout_seconds: int = Field(15, alias="EMPLOYEE_SYNC_TIMEOUT_SECONDS")
    employee_sync_auto_create_user: bool = Field(True, alias="EMPLOYEE_SYNC_AUTO_CREATE_USER")

    # ---- 阿里云 OSS（魔学院视频）----
    oss_access_key_id: str = Field("", alias="OSS_ACCESS_KEY_ID")
    oss_access_key_secret: str = Field("", alias="OSS_ACCESS_KEY_SECRET")
    oss_endpoint: str = Field("", alias="OSS_ENDPOINT")
    oss_bucket: str = Field("", alias="OSS_BUCKET")
    oss_public_base_url: str = Field("", alias="OSS_PUBLIC_BASE_URL")
    oss_upload_prefix: str = Field("", alias="OSS_UPLOAD_PREFIX")
    oss_signed_url_expire_seconds: int = Field(21600, alias="OSS_SIGNED_URL_EXPIRE_SECONDS")
    magic_video_max_size_mb: int = Field(10240, alias="MAGIC_VIDEO_MAX_SIZE_MB")
    live_comment_block_words: str = Field(
        "赌博,诈骗,色情,暴力,辱骂",
        alias="LIVE_COMMENT_BLOCK_WORDS",
    )

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
    def wecom_ready(self) -> bool:
        return self.wecom_login_ready

    @property
    def wecom_push_ready(self) -> bool:
        return bool(
            self.wecom_enabled
            and self.wecom_push_enabled
            and self.wecom_corp_id.strip()
            and self.wecom_agent_id
            and self.wecom_app_secret.strip()
        )

    @property
    def wecom_login_ready(self) -> bool:
        return bool(
            self.wecom_enabled
            and self.wecom_login_enabled
            and self.wecom_corp_id.strip()
            and self.wecom_agent_id
            and self.wecom_app_secret.strip()
            and self.wecom_contact_secret.strip()
            and self.wecom_redirect_uri.strip()
            and self.wecom_frontend_callback_url.strip()
        )

    @property
    def wecom_sync_ready(self) -> bool:
        return bool(
            self.wecom_enabled
            and self.wecom_sync_enabled
            and self.wecom_corp_id.strip()
            and self.wecom_contact_secret.strip()
        )

    @property
    def wechat_mp_ready(self) -> bool:
        return bool(
            self.wechat_mp_enabled
            and self.wechat_mp_app_id.strip()
            and self.wechat_mp_app_secret.strip()
        )

    @property
    def employee_sync_ready(self) -> bool:
        return bool(
            self.employee_sync_enabled
            and self.employee_sync_base_url.strip()
            and self.employee_sync_app_id.strip()
            and self.employee_sync_partner_private_key.strip()
        )

    @property
    def resolved_wecom_frontend_base_url(self) -> str:
        if self.wecom_frontend_base_url.strip():
            return self.wecom_frontend_base_url.rstrip("/")
        callback = self.wecom_frontend_callback_url.strip()
        if not callback:
            return ""
        parsed = urlparse(callback)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
        return callback.rstrip("/")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
