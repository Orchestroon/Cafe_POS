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


def parse_range(params, tz_name: str, *, default_today: bool):
    """`from`/`to` query params (local dates) -> (date_from, date_to, utc_lo, utc_hi).
    None when neither is given and default_today is False. A missing end is the local today."""
    f, t = params.get("from"), params.get("to")
    if not f and not t and not default_today:
        return None
    today = datetime.now(ZoneInfo(tz_name)).date()
    d_to = parse_local_date(t, "to") if t else today
    d_from = parse_local_date(f, "from") if f else (date(2000, 1, 1) if t else today)
    if d_from > d_to:
        raise ValidationError({"from": "Must not be after 'to'."})
    return (d_from, d_to, *local_date_range(d_from, d_to, tz_name))
