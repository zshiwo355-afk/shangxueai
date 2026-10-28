"""Offline boundary checks; MySQL transaction/concurrency checks live in test_mall_mysql.py."""
import io
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from PIL import Image
from pydantic import ValidationError

from app.auth import get_current_user, require_admin
from app.mall_api import (
    CreateProductPayload, DanmakuPayload, GrantPayload, ProductPayload, RedemptionPayload, UpdateProductPayload,
    _danmaku_cooldown, _image_url, _iso, _now, admin_router, router, upload_image,
)
from app.models import User


class MallValidationTest(unittest.TestCase):
    def test_danmaku_accepts_unicode_codepoints_and_trims_text(self):
        self.assertEqual(DanmakuPayload(content="  加油 🎉  ").content, "加油 🎉")
        self.assertEqual(DanmakuPayload(content="🎉" * 50).content, "🎉" * 50)
        for content in ("", " \n\t ", "🎉" * 51, None, 123):
            with self.subTest(content=content), self.assertRaises(ValidationError):
                DanmakuPayload(content=content)
        with self.assertRaises(ValidationError):
            DanmakuPayload(content="加油", user_name="冒充他人")

    def test_danmaku_cooldown_never_rounds_down_before_five_seconds(self):
        now = datetime(2026, 10, 28, 8, 0, 5, 100)
        self.assertEqual(_danmaku_cooldown(None, now), 0)
        for elapsed, expected in ((0, 5), (0.1, 5), (4.99, 1), (5, 0), (20, 0)):
            with self.subTest(elapsed=elapsed):
                self.assertEqual(_danmaku_cooldown(now - timedelta(seconds=elapsed), now), expected)

    def test_product_price_requires_whole_points(self):
        for price in (0, 19, 21, 30, 20.0, "20", True, 2_000_000_020):
            with self.subTest(price=price), self.assertRaises(ValidationError):
                ProductPayload(name="茶杯", price_yuan=price, stock=1)
        self.assertEqual(ProductPayload(name="茶杯", price_yuan=40, stock=1).price_yuan, 40)

    def test_blank_names_and_invalid_stock_are_rejected(self):
        for name, stock in (("  ", 1), ("茶杯", -1), ("茶杯", 1.5), ("茶杯", True)):
            with self.subTest(name=name, stock=stock), self.assertRaises(ValidationError):
                ProductPayload(name=name, price_yuan=20, stock=stock)

    def test_grant_is_positive_integer_with_nonblank_reason(self):
        for points, remark in ((0, "奖励"), (-1, "奖励"), (1.5, "奖励"), (True, "奖励"), (1, "  ")):
            with self.subTest(points=points, remark=remark), self.assertRaises(ValidationError):
                GrantPayload(user_id=2, points=points, remark=remark, request_id="request-0001")
        valid = GrantPayload(user_id=2, points=10, remark="  活动奖励  ", request_id="request-0001")
        self.assertEqual(valid.remark, "活动奖励")

    def test_grant_rejects_client_balance_fields(self):
        with self.assertRaises(ValidationError):
            GrantPayload(user_id=2, points=10, remark="奖励", request_id="request-0001", balance_points=999)

    def test_redemption_requires_idempotency_key_and_price_confirmation(self):
        for overrides in ({"request_id": ""}, {"request_id": "a/bad/key"}, {"expected_price_yuan": 30}, {"product_id": -1}):
            with self.subTest(overrides=overrides), self.assertRaises(ValidationError):
                RedemptionPayload(**({"product_id": 1, "expected_price_yuan": 20, "request_id": "request-0001"} | overrides))
        with self.assertRaises(ValidationError):
            RedemptionPayload(product_id=1, expected_price_yuan=20, request_id="request-0001", user_id=99)

    def test_product_edit_requires_monotonic_version(self):
        with self.assertRaises(ValidationError):
            UpdateProductPayload(name="茶杯", price_yuan=20, stock=1)
        value = UpdateProductPayload(name="茶杯", price_yuan=20, stock=1, expected_version=2)
        self.assertEqual(value.expected_version, 2)
        with self.assertRaises(ValidationError):
            UpdateProductPayload(name="茶杯", price_yuan=20, stock=1, expected_stock=1)

    def test_product_creation_requires_retry_key(self):
        with self.assertRaises(ValidationError):
            CreateProductPayload(name="茶杯", price_yuan=20, stock=1)
        value = CreateProductPayload(name="茶杯", price_yuan=20, stock=1, request_id="request-0001")
        self.assertEqual(value.request_id, "request-0001")

    def test_image_addresses_allow_https_and_system_static_assets(self):
        for url in ("https://example.com/image.png", "/assets/image.webp", ""):
            self.assertEqual(_image_url(url), url)

    def test_image_addresses_reject_unsafe_and_admin_only_urls(self):
        for url in (
            "javascript:alert(1)", "data:image/png;base64,aaa", "http://example.com/a.png",
            "//example.com/a.png", "https://user:pass@example.com/a.png", "/assets/../secret",
            "/assets/%2e%2e/secret", "/assets/a%0ab.png", "/assets/\\evil.png",
            "/api/materials/assets/1/preview?token=private", "https://example.com/a.png#secret",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                _image_url(url)

    def test_time_precision_is_stable_after_mysql_datetime_storage(self):
        self.assertEqual(_now().microsecond, 0)
        self.assertEqual(_iso(datetime(2026, 10, 26, 3, 4, 5)), "2026-10-26T03:04:05+00:00")

    def test_every_admin_route_enforces_admin_authentication(self):
        self.assertTrue(admin_router.routes)
        for route in admin_router.routes:
            with self.subTest(path=route.path):
                self.assertIn(require_admin, [dependency.call for dependency in route.dependant.dependencies])

    def test_every_employee_route_uses_logged_in_identity(self):
        self.assertTrue(router.routes)
        for route in router.routes:
            with self.subTest(path=route.path):
                self.assertIn(get_current_user, [dependency.call for dependency in route.dependant.dependencies])


class MallImageUploadTest(unittest.IsolatedAsyncioTestCase):
    def image_bytes(self):
        stream = io.BytesIO()
        Image.new("RGB", (2, 2), "white").save(stream, format="PNG")
        return stream.getvalue()

    async def test_upload_reuses_oss_with_verified_image_type(self):
        raw = self.image_bytes()
        with (
            patch("app.mall_api._build_object_key_and_name", return_value=("mall/image.png", "image.png")),
            patch("app.mall_api._ensure_oss_settings", return_value={"public_base_url": "https://images.example.com"}),
            patch("app.mall_api._upload_binary_to_oss") as upload,
        ):
            result = await upload_image(UploadFile(file=io.BytesIO(raw), filename="misnamed.svg"), User(id=1))
        self.assertEqual(result, {"image_url": "https://images.example.com/mall/image.png"})
        upload.assert_called_once_with("mall/image.png", raw, "image/png")

    async def test_spoofed_image_never_reaches_storage(self):
        with patch("app.mall_api._upload_binary_to_oss") as upload, self.assertRaises(HTTPException) as failure:
            await upload_image(UploadFile(file=io.BytesIO(b"<svg onload='alert(1)'></svg>"), filename="image.png"), User(id=1))
        self.assertEqual(failure.exception.status_code, 400)
        upload.assert_not_called()

    async def test_empty_and_oversized_image_never_reach_storage(self):
        for raw in (b"", b"12345"):
            with (
                self.subTest(size=len(raw)),
                patch("app.mall_api.MAX_READING_IMAGE_SIZE", 4),
                patch("app.mall_api._upload_binary_to_oss") as upload,
                self.assertRaises(HTTPException) as failure,
            ):
                await upload_image(UploadFile(file=io.BytesIO(raw), filename="image.png"), User(id=1))
            self.assertEqual(failure.exception.status_code, 400)
            upload.assert_not_called()

    async def test_decompression_bomb_never_reaches_storage(self):
        with (
            patch("app.mall_api.Image.open", side_effect=Image.DecompressionBombError("too large")),
            patch("app.mall_api._upload_binary_to_oss") as upload,
            self.assertRaises(HTTPException) as failure,
        ):
            await upload_image(UploadFile(file=io.BytesIO(b"image"), filename="image.png"), User(id=1))
        self.assertEqual(failure.exception.status_code, 400)
        upload.assert_not_called()

    async def test_http_storage_configuration_is_rejected_before_upload(self):
        with (
            patch("app.mall_api._build_object_key_and_name", return_value=("mall/image.png", "image.png")),
            patch("app.mall_api._ensure_oss_settings", return_value={"public_base_url": "http://images.example.com"}),
            patch("app.mall_api._upload_binary_to_oss") as upload,
            self.assertRaises(HTTPException) as failure,
        ):
            await upload_image(UploadFile(file=io.BytesIO(self.image_bytes()), filename="image.png"), User(id=1))
        self.assertEqual(failure.exception.status_code, 503)
        upload.assert_not_called()


if __name__ == "__main__":
    unittest.main()
