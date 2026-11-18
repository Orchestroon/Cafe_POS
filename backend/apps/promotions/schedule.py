"""When is a promotion live? Pure (no database). All times are the café's local wall clock."""

from datetime import date, datetime, timedelta


def _in_window(t, start, end) -> bool:
    """[start, end) on one local day; an overnight window (start > end) wraps midnight."""
    return start <= t < end if start < end else t >= start or t < end


def is_live(starts_on, ends_on, days_of_week, window_start, window_end, now: datetime) -> bool:
    """`now` is a timezone-aware local datetime. `days_of_week` uses Monday = 0; empty = every day.
    For an overnight window the day belongs to the day the window STARTED: Friday 22:00-02:00 is
    still Friday's promotion at Saturday 01:00 (the dates and the day list are checked against
    Friday)."""

    def day_ok(d: date) -> bool:
        return (
            (starts_on is None or d >= starts_on)
            and (ends_on is None or d <= ends_on)
            and (not days_of_week or d.weekday() in days_of_week)
        )

    if window_start is None:
        return day_ok(now.date())
    t = now.time().replace(tzinfo=None)
    if window_start < window_end:
        return day_ok(now.date()) and _in_window(t, window_start, window_end)
    if window_start == window_end:  # a 24 h window: validation rejects it, treat as always
        return day_ok(now.date())
    if t >= window_start:  # evening part, belongs to today
        return day_ok(now.date())
    # early-morning part: belongs to yesterday's window
    return t < window_end and day_ok(now.date() - timedelta(days=1))
