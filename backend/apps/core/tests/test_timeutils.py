from datetime import UTC, date, datetime, timedelta

import pytest
from rest_framework.exceptions import ValidationError

from apps.core.timeutils import local_date_range, parse_local_date


def test_normal_day_in_cairo_winter():
    start, end = local_date_range(date(2026, 1, 10), date(2026, 1, 10), "Africa/Cairo")
    assert start == datetime(2026, 1, 9, 22, 0, tzinfo=UTC)  # +02:00
    assert end - start == timedelta(hours=24)


def test_dst_start_day_has_23_hours():
    # Egypt DST starts the last Friday of April (2026-04-24): never hardcode +02:00.
    start, end = local_date_range(date(2026, 4, 24), date(2026, 4, 24), "Africa/Cairo")
    assert end - start == timedelta(hours=23)


def test_range_spans_days_inclusive():
    start, end = local_date_range(date(2026, 1, 1), date(2026, 1, 3), "Africa/Cairo")
    assert end - start == timedelta(hours=72)


def test_parse_local_date():
    assert parse_local_date("2026-11-08") == date(2026, 11, 8)
    with pytest.raises(ValidationError):
        parse_local_date("08/11/2026")
