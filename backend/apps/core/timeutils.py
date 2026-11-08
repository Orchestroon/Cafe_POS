from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from rest_framework.exceptions import ValidationError


def local_date_range(date_from: date, date_to: date, tz_name: str):
    """Local dates [from, to] inclusive -> UTC range [from 00:00, to+1 00:00) (spec 5.7)."""
    tz = ZoneInfo(tz_name)
    start = datetime.combine(date_from, time.min, tzinfo=tz)
    end = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=tz)
    return start.astimezone(UTC), end.astimezone(UTC)


def parse_local_date(value: str, field: str = "date") -> date:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValidationError({field: "Use YYYY-MM-DD."}) from None
