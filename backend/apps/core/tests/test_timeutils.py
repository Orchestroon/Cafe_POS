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


@pytest.mark.parametrize("bad", ["0001-01-01", "9999-12-31", "1999-12-31", "2101-01-01"])
def test_parse_local_date_rejects_years_outside_the_window(bad):
    with pytest.raises(ValidationError):
        parse_local_date(bad)
    assert parse_local_date("2000-01-01") and parse_local_date("2100-12-31")


@pytest.mark.django_db
@pytest.mark.parametrize(
    "path",
    ["reports/sales-summary", "refunds", "payments", "expenses", "shifts", "orders"],
)
@pytest.mark.parametrize("q", ["from=0001-01-01", "to=9999-12-31"])
def test_extreme_dates_are_400_not_500(admin_c, path, q):
    assert admin_c.get(f"/api/v1/{path}?{q}").status_code == 400
