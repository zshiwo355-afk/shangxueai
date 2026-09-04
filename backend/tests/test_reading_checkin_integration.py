import inspect
import unittest
from datetime import date, datetime, time, timedelta
from types import SimpleNamespace

from fastapi import HTTPException

from app.magic_academy_api.audio import (
    _build_reading_checkin_integration_items,
    _filter_reading_checkin_integration_items,
    _resolve_reading_checkin_query_range,
    get_reading_checkins_integration,
    integration_router,
)


def user(user_id: int, *, department: str = "AI运营部", disabled: bool = False):
    return SimpleNamespace(
        id=user_id,
        username=f"user-{user_id}",
        real_name=f"员工{user_id}",
        display_name="",
        department=department,
        position="运营",
        employment_status="在职",
        role="user",
        is_newcomer=False,
        job_level="M线",
        disabled=disabled,
        status="active" if not disabled else "inactive",
    )


def content(content_id: int, reading_date: date, *, push_at: datetime | None = None):
    return SimpleNamespace(
        id=content_id,
        reading_date=reading_date,
        push_at=push_at or datetime.combine(reading_date, time(hour=8)),
        push_time=time(hour=8),
        makeup_deadline_at=datetime.combine(reading_date + timedelta(days=3), time(hour=23, minute=59)),
        title=f"读书内容{content_id}",
    )


def upload(
    upload_id: int,
    user_id: int,
    content_id: int | None,
    checkin_date: date,
    submitted_at: datetime,
    *,
    source: str = "user_upload",
    audio: bool = False,
    image: bool = False,
):
    return SimpleNamespace(
        id=upload_id,
        user_id=user_id,
        reading_content_id=content_id,
        uploaded_date=checkin_date,
        uploaded_on=submitted_at,
        source=source,
        auto_checkin_by_whitelist=False,
        audio_object_key="audio/key" if audio else "",
        file_name="checkin.m4a" if audio else "",
        file_size=100 if audio else 0,
        image_object_key="image/key" if image else "",
        image_file_name="checkin.jpg" if image else "",
        media_purged_at=None,
    )


class ReadingCheckinQueryRangeTest(unittest.TestCase):
    def test_supports_single_date_or_range_but_not_both(self) -> None:
        target = date(2026, 8, 21)
        self.assertEqual(_resolve_reading_checkin_query_range(target, None, None), (target, target))
        self.assertEqual(
            _resolve_reading_checkin_query_range(None, target, target + timedelta(days=2)),
            (target, target + timedelta(days=2)),
        )

        with self.assertRaises(HTTPException):
            _resolve_reading_checkin_query_range(target, target, target)
        with self.assertRaises(HTTPException):
            _resolve_reading_checkin_query_range(None, target, None)
        with self.assertRaises(HTTPException):
            _resolve_reading_checkin_query_range(None, target, target + timedelta(days=31))


class ReadingCheckinIntegrationItemsTest(unittest.TestCase):
    def test_groups_by_person_and_business_date_and_uses_push_snapshot(self) -> None:
        day1 = date(2026, 8, 1)
        day2 = date(2026, 8, 2)
        people = [user(1), user(2)]
        contents = [content(10, day1), content(11, day2)]
        targets = {
            10: [SimpleNamespace(target_type="department", target_id="AI运营部")],
            11: [SimpleNamespace(target_type="department", target_id="AI运营部")],
        }
        uploads = [
            upload(101, 1, 10, day1, datetime(2026, 8, 3, 10), source="makeup", image=True),
            upload(102, 1, 10, day1, datetime(2026, 8, 3, 10, 5), source="makeup", image=True),
            upload(103, 2, None, day1, datetime(2026, 8, 1, 9), audio=True),
        ]
        deleted_uploads = [
            upload(104, 2, 11, day2, datetime(2026, 8, 2, 9), image=True),
        ]

        items, warnings = _build_reading_checkin_integration_items(
            contents=contents,
            users=people,
            pushed_content_ids={10},
            push_recipient_ids_by_content={10: {1}},
            targets_map=targets,
            uploads=uploads,
            deleted_uploads=deleted_uploads,
            now=datetime(2026, 8, 6, 12),
        )

        keyed = {(item["user_id"], item["checkin_date"]): item for item in items}
        self.assertEqual(len(items), 4)
        self.assertEqual(keyed[(1, day1)]["assignment_source"], "push_snapshot")
        self.assertTrue(keyed[(1, day1)]["checked_in"])
        self.assertTrue(keyed[(1, day1)]["has_makeup"])
        self.assertEqual(keyed[(1, day1)]["checkin_methods"], ["image"])
        self.assertEqual(keyed[(1, day1)]["checkin_ids"], [101, 102])
        self.assertEqual(keyed[(2, day1)]["status"], "completed_without_assignment")
        self.assertEqual(keyed[(2, day2)]["status"], "deleted")
        self.assertTrue(any("duplicate_active_checkins" in warning for warning in warnings))

    def test_incomplete_filter_excludes_future_rows(self) -> None:
        rows = [
            {"checked_in": True, "should_checkin": True, "is_due": True, "status": "completed"},
            {"checked_in": False, "should_checkin": True, "is_due": True, "status": "pending"},
            {"checked_in": False, "should_checkin": True, "is_due": False, "status": "future"},
        ]
        self.assertEqual(
            _filter_reading_checkin_integration_items(rows, checked_in=False, status="all"),
            [rows[1]],
        )
        self.assertEqual(
            _filter_reading_checkin_integration_items(rows, checked_in=None, status="incomplete"),
            [rows[1]],
        )


class ReadingCheckinIntegrationRouteTest(unittest.TestCase):
    def test_route_is_registered_without_an_auth_dependency(self) -> None:
        route = next(route for route in integration_router.routes if route.path == "/api/integrations/v1/reading-checkins")
        self.assertEqual(route.methods, {"GET"})
        self.assertNotIn("admin", inspect.signature(get_reading_checkins_integration).parameters)
        self.assertNotIn("user", inspect.signature(get_reading_checkins_integration).parameters)


if __name__ == "__main__":
    unittest.main()
