from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Request

from app import lottery_api
from app.lottery_api import (
    CampaignPayload,
    _ensure_pending_claim_for_win,
    create_campaign,
    public_share_image,
    share_payload,
    upload_lottery_image,
)
from app.magic_academy_api._oss import MAX_READING_IMAGE_SIZE
from app.models import LotteryClaim, User


def _complete_without_event_loop(coroutine):
    """The fakes below never suspend, so drive the coroutine without a loop."""
    try:
        coroutine.send(None)
    except StopIteration as exc:
        return exc.value
    raise AssertionError("test coroutine unexpectedly yielded")


class _ScalarResult:
    def __init__(self, value=None):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class _CampaignSession:
    def __init__(self):
        self.added = []
        self.refreshed = []

    async def execute(self, _statement):
        return _ScalarResult()

    def add(self, value):
        self.added.append(value)

    async def flush(self):
        return None

    async def refresh(self, value):
        self.refreshed.append(value)
        value.id = 101
        value.created_at = datetime(2026, 10, 22, 3, 0, 0)
        value.updated_at = datetime(2026, 10, 22, 3, 0, 0)


class _ClaimSession:
    def __init__(self, existing=None):
        self.existing = existing
        self.added = []
        self.flush_count = 0

    async def execute(self, _statement):
        return _ScalarResult(self.existing)

    def add(self, value):
        self.added.append(value)

    async def flush(self):
        self.flush_count += 1


class _Upload:
    def __init__(self, content: bytes, *, filename: str = "prize.png", content_type: str = "image/png"):
        self.content = content
        self.filename = filename
        self.content_type = content_type
        self.read_size = None

    async def read(self, size: int = -1) -> bytes:
        self.read_size = size
        return self.content[:size]


def test_create_campaign_refreshes_server_defaults_before_serializing() -> None:
    db = _CampaignSession()
    admin = User(id=9, username="admin")

    result = _complete_without_event_loop(
        create_campaign(CampaignPayload(title="双十一客户抽奖"), db, admin)
    )

    assert len(db.refreshed) == 1
    assert result["item"]["id"] == 101
    assert result["item"]["created_at"] == "2026-10-22T03:00:00+08:00"
    assert result["item"]["updated_at"] == "2026-10-22T03:00:00+08:00"


def test_winning_draw_creates_pending_claim_without_customer_input() -> None:
    db = _ClaimSession()
    draw = SimpleNamespace(id=88, campaign_id=7, result_type="win")
    link = SimpleNamespace(id=19, customer_name="  王女士  ")

    claim = _complete_without_event_loop(
        _ensure_pending_claim_for_win(db, draw=draw, link=link)
    )

    assert claim is db.added[0]
    assert claim.campaign_id == 7
    assert claim.invite_link_id == 19
    assert claim.draw_id == 88
    assert claim.recipient_name == "王女士"
    assert claim.recipient_phone == ""
    assert claim.recipient_address == ""
    assert claim.status == "pending"
    assert db.flush_count == 1


def test_winning_draw_retry_reuses_existing_claim() -> None:
    existing = LotteryClaim(
        campaign_id=7,
        invite_link_id=19,
        draw_id=88,
        recipient_name="王女士",
        recipient_phone="",
        recipient_address="",
        status="pending",
    )
    db = _ClaimSession(existing=existing)

    claim = _complete_without_event_loop(
        _ensure_pending_claim_for_win(
            db,
            draw=SimpleNamespace(id=88, campaign_id=7, result_type="win"),
            link=SimpleNamespace(id=19, customer_name="王女士"),
        )
    )

    assert claim is existing
    assert db.added == []
    assert db.flush_count == 0


def test_non_winning_draw_does_not_create_claim() -> None:
    db = _ClaimSession()

    claim = _complete_without_event_loop(
        _ensure_pending_claim_for_win(
            db,
            draw=SimpleNamespace(id=89, campaign_id=7, result_type="no_win"),
            link=SimpleNamespace(id=19, customer_name="王女士"),
        )
    )

    assert claim is None
    assert db.added == []
    assert db.flush_count == 0


def test_lottery_image_upload_is_limited_and_returns_object_reference(monkeypatch) -> None:
    uploaded = {}

    async def immediate_to_thread(function, *args):
        return function(*args)

    def fake_upload(object_key, content, mime_type):
        uploaded.update(object_key=object_key, content=content, mime_type=mime_type)

    monkeypatch.setattr(lottery_api.asyncio, "to_thread", immediate_to_thread)
    monkeypatch.setattr(lottery_api, "_build_object_key_and_name", lambda *_args: ("lottery/2026/prize.png", "prize.png"))
    monkeypatch.setattr(lottery_api, "_upload_binary_to_oss", fake_upload)
    monkeypatch.setattr(lottery_api, "_object_public_url", lambda key: f"https://cdn.example/{key}")

    upload = _Upload(b"png-bytes")
    result = _complete_without_event_loop(upload_lottery_image(upload, User(id=9, username="admin")))

    assert upload.read_size == MAX_READING_IMAGE_SIZE + 1
    assert uploaded == {
        "object_key": "lottery/2026/prize.png",
        "content": b"png-bytes",
        "mime_type": "image/png",
    }
    assert result["url"] == "https://cdn.example/lottery/2026/prize.png"
    assert result["object_key"] == "lottery/2026/prize.png"
    assert result["file_size"] == len(b"png-bytes")


def test_lottery_image_upload_rejects_more_than_ten_megabytes() -> None:
    upload = _Upload(b"x" * (MAX_READING_IMAGE_SIZE + 1))

    with pytest.raises(HTTPException) as exc_info:
        _complete_without_event_loop(upload_lottery_image(upload, User(id=9, username="admin")))

    assert exc_info.value.status_code == 400
    assert "10MB" in str(exc_info.value.detail)


@pytest.mark.parametrize(
    ("content", "filename", "content_type", "detail"),
    [
        (b"", "empty.png", "image/png", "大于 0"),
        (b"not-an-image", "prize.gif", "image/gif", "jpg"),
    ],
)
def test_lottery_image_upload_rejects_empty_or_unsupported_files(
    content: bytes,
    filename: str,
    content_type: str,
    detail: str,
) -> None:
    upload = _Upload(content, filename=filename, content_type=content_type)

    with pytest.raises(HTTPException) as exc_info:
        _complete_without_event_loop(upload_lottery_image(upload, User(id=9, username="admin")))

    assert exc_info.value.status_code == 400
    assert detail in str(exc_info.value.detail)


def _request(*, method: str = "GET") -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": method,
            "scheme": "https",
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": [],
            "client": ("127.0.0.1", 1234),
            "server": ("example.test", 443),
        }
    )


def test_share_payload_uses_same_origin_proxy_for_uploaded_image(monkeypatch) -> None:
    monkeypatch.setattr(lottery_api, "_public_base", lambda _request: "https://example.test")
    campaign = SimpleNamespace(
        title="双十一客户抽奖",
        description="",
        share_title="",
        share_desc="",
        share_image_url="https://bucket.example/share.jpg",
        share_image_object_key="lottery/share.jpg",
        hero_image_url="",
        hero_image_object_key="",
        config_version=7,
    )
    link = SimpleNamespace(public_code="abc/123")

    result = share_payload(campaign, link, _request())

    assert result["image"] == "https://example.test/api/public/lottery/abc%2F123/share-image.jpg?v=7"
    assert result["url"] == "https://example.test/share/lottery/abc%2F123?card=3"


def test_public_share_image_returns_inline_image_headers(monkeypatch) -> None:
    campaign = SimpleNamespace(
        share_image_object_key="lottery/share-card.jpg",
        hero_image_object_key="",
    )
    link = SimpleNamespace(public_code="abc123")

    async def fake_context(_db, _public_code, *, lock=False):
        del lock
        return campaign, link

    async def immediate_to_thread(function, *args):
        return function(*args)

    class FakeBucket:
        def head_object(self, object_key):
            assert object_key == "lottery/share-card.jpg"
            return SimpleNamespace(content_length=321, content_type="image/jpeg", etag="abc-etag")

    monkeypatch.setattr(lottery_api, "_public_link_context", fake_context)
    monkeypatch.setattr(lottery_api, "_build_oss_bucket", FakeBucket)
    monkeypatch.setattr(lottery_api.asyncio, "to_thread", immediate_to_thread)

    response = _complete_without_event_loop(public_share_image("abc123", _request(method="HEAD"), object()))

    assert response.status_code == 200
    assert response.media_type == "image/jpeg"
    assert response.headers["content-disposition"] == "inline"
    assert response.headers["content-length"] == "321"
    assert response.headers["cache-control"] == "public, max-age=300"
    assert response.headers["etag"] == '"abc-etag"'
