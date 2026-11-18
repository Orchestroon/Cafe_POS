from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from apps.promotions.schedule import is_live

CAIRO = ZoneInfo("Africa/Cairo")


def at(y, m, d, hh=0, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=CAIRO)


def live(now, start=None, end=None, days=(), ws=None, we=None):
    return is_live(start, end, list(days), ws, we, now)


def test_no_rules_is_always_live():
    assert live(at(2026, 11, 18, 3, 0))


def test_date_range_is_inclusive_at_both_ends():
    rng = dict(start=date(2026, 11, 10), end=date(2026, 11, 12))
    assert not live(at(2026, 11, 9, 23, 59), **rng)
    assert live(at(2026, 11, 10, 0, 0), **rng)
    assert live(at(2026, 11, 12, 23, 59), **rng)
    assert not live(at(2026, 11, 13, 0, 0), **rng)


def test_days_of_week_monday_is_zero():
    mon_fri = (0, 1, 2, 3, 4)
    assert live(at(2026, 11, 16, 12), days=mon_fri)  # Monday
    assert not live(at(2026, 11, 21, 12), days=mon_fri)  # Saturday


def test_happy_hour_window_end_is_exclusive():
    w = dict(ws=time(15), we=time(17))
    assert not live(at(2026, 11, 18, 14, 59), **w)
    assert live(at(2026, 11, 18, 15, 0), **w)
    assert live(at(2026, 11, 18, 16, 59), **w)
    assert not live(at(2026, 11, 18, 17, 0), **w)


def test_overnight_window_belongs_to_the_day_it_started():
    # Friday 22:00 - 02:00, Fridays only (2026-11-20 is a Friday)
    w = dict(ws=time(22), we=time(2), days=(4,))
    assert live(at(2026, 11, 20, 23, 0), **w)
    assert live(at(2026, 11, 21, 1, 30), **w)  # Saturday morning, still Friday's window
    assert not live(at(2026, 11, 21, 2, 0), **w)
    assert not live(at(2026, 11, 21, 23, 0), **w)  # Saturday night: Saturday is not a listed day
    assert not live(at(2026, 11, 20, 1, 30), **w)  # Friday early morning is Thursday's window


def test_overnight_window_uses_the_start_day_for_the_date_range_too():
    w = dict(ws=time(22), we=time(2), end=date(2026, 11, 20))
    assert live(at(2026, 11, 21, 1, 0), **w)  # started on the last day
    assert not live(at(2026, 11, 21, 23, 0), **w)


def test_local_wall_clock_across_a_dst_change():
    # Egypt moves clocks forward on the last Friday of April (2026-04-24, 00:00 -> 01:00).
    w = dict(ws=time(15), we=time(17))
    assert live(at(2026, 4, 23, 16), **w) and live(at(2026, 4, 25, 16), **w)
    assert not live(at(2026, 4, 25, 17), **w)
