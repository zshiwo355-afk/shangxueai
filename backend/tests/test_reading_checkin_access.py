import inspect
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.params import Depends

from app.auth import require_admin
from app.magic_academy_api.audio import list_admin_audios_by_date


class ReadingCheckinAccessTest(unittest.TestCase):
    def test_by_date_query_allows_admin_dependency(self) -> None:
        dependency = inspect.signature(list_admin_audios_by_date).parameters["admin"].default

        self.assertIsInstance(dependency, Depends)
        self.assertIs(dependency.dependency, require_admin)


class ReadingCheckinResponseTest(unittest.IsolatedAsyncioTestCase):
    async def test_by_date_exposes_only_the_stored_makeup_marker(self) -> None:
        rows = [
            SimpleNamespace(
                id=1,
                user_id=7,
                reading_content_id=11,
                file_name="first.mp3",
                file_size=1,
                mime_type="audio/mpeg",
                audio_object_key="first",
                transcript_status="completed",
                transcript_text="",
                transcript_error="",
                transcribed_at=None,
                uploaded_on=datetime(2026, 8, 15, 16, 24, 16),
                source="user_upload",
                is_deleted=False,
            ),
            SimpleNamespace(
                id=2,
                user_id=7,
                reading_content_id=12,
                file_name="second.mp3",
                file_size=1,
                mime_type="audio/mpeg",
                audio_object_key="second",
                transcript_status="completed",
                transcript_text="",
                transcript_error="",
                transcribed_at=None,
                uploaded_on=datetime(2026, 8, 15, 16, 26, 44),
                source="makeup",
                is_deleted=False,
            ),
        ]

        class Result:
            def scalars(self):
                return self

            def all(self):
                return rows

        db = SimpleNamespace(execute=AsyncMock(return_value=Result()))
        owner = SimpleNamespace(real_name="测试用户", display_name="", username="test", department="测试部")

        with (
            patch("app.magic_academy_api.audio.is_super_admin", return_value=True),
            patch("app.magic_academy_api.audio._build_user_map", new=AsyncMock(return_value={7: owner})),
            patch("app.magic_academy_api.audio._build_signed_inline_url", return_value="https://signed.example"),
        ):
            result = await list_admin_audios_by_date(
                "2026-08-13",
                db=db,
                admin=SimpleNamespace(id=1),
            )

        self.assertEqual([item["is_makeup"] for item in result["items"]], [False, True])


if __name__ == "__main__":
    unittest.main()
