from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.lottery_time import format_db_timestamp


def test_database_local_time_has_explicit_shanghai_offset():
    rendered = format_db_timestamp(datetime(2026, 10, 22, 14, 48, 41), offset="+08:00")
    assert rendered == "2026-10-22T14:48:41+08:00"
    assert datetime.fromisoformat(rendered).astimezone(timezone.utc).hour == 6


def test_aware_time_is_not_shifted_again():
    value = datetime(2026, 10, 22, 6, 48, tzinfo=timezone.utc)
    assert format_db_timestamp(value, offset="+08:00") == "2026-10-22T06:48:00Z"


def test_null_and_other_database_offsets():
    assert format_db_timestamp(None) is None
    value = datetime(2026, 10, 22, 6, 48)
    assert format_db_timestamp(value, offset="+00:00") == "2026-10-22T06:48:00Z"
    assert format_db_timestamp(value, offset="-03:30").endswith("-03:30")


def test_business_timestamps_stay_utc():
    from app.lottery_api import _iso

    assert _iso(datetime(2026, 10, 22, 6, 48)) == "2026-10-22T06:48:00Z"


@pytest.mark.parametrize("offset", ["Asia/Shanghai", "08:00", "+99:00", "+14:30"])
def test_invalid_database_offset_is_rejected(offset):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, MAXKB_BASE_URL="http://localhost", LOTTERY_DB_TIMESTAMP_OFFSET=offset)
