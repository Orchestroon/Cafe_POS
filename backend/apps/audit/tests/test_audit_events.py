"""GET /audit-events (spec 9.3, Sprint 4): Admin-only, read-only, filters, café-local dates,
tenant isolation."""

from datetime import timedelta

import pytest
from django.db import connection
from django.utils import timezone

from apps.audit.models import AuditEvent
from apps.audit.services import record
from apps.sales.selectors import local_today, org_timezone
from apps.sales.tests.conftest import cash, checkout, item, open_shift, refund
from conftest import data

pytestmark = pytest.mark.django_db

URL = "/api/v1/audit-events"


@pytest.fixture
def history(shop, barista_c, barista, admin):
    open_shift(barista_c)
    sold = data(checkout(barista_c, [item(shop.small)], [cash("65.00")], "65.00"))
    refund(barista_c, sold["order_id"], "65.00", "Wrong drink")
    return {"order_id": sold["order_id"], "barista": barista, "admin": admin}


def rows(client, **params):
    r = client.get(URL, params)
    assert r.status_code == 200, r.content
    return r.json()


def test_newest_first_with_actor_and_summary(admin_c, history):
    body = rows(admin_c)
    events = body["data"]
    stamps = [e["created_at"] for e in events]
    assert stamps == sorted(stamps, reverse=True)
    top = events[0]
    assert top["action"] == "refund.created"
    assert top["actor"]["username"] == history["barista"].username
    assert top["summary"]["reason"] == "Wrong drink"
    assert set(top) == {
        "id",
        "created_at",
        "action",
        "entity_type",
        "entity_id",
        "entity_label",
        "actor",
        "summary",
    }
    meta = body["meta"]
    assert meta["total_count"] == AuditEvent.objects.count()
    assert {"order.created", "refund.created", "shift.opened"} <= set(meta["actions"])
    assert "sales.order" in meta["entity_types"]


def test_filters_each_and_combined(admin_c, history):
    oid = history["order_id"]
    created = rows(admin_c, action="order.created")["data"]
    assert [e["entity_id"] for e in created] == [oid]
    by_entity = rows(admin_c, entity_type="sales.order", entity_id=oid)["data"]
    assert [e["action"] for e in by_entity] == ["order.created"]
    by_actor = rows(admin_c, actor_id=str(history["barista"].pk))["data"]
    assert by_actor and all(e["actor"]["id"] == str(history["barista"].pk) for e in by_actor)
    both = rows(admin_c, action="refund.created", actor_id=str(history["admin"].pk))["data"]
    assert both == []


def test_local_date_boundaries(admin_c, org, admin):
    tz = org_timezone(org)
    today = local_today(tz)
    old = record(admin, "test.old", admin, {"n": 1})
    with connection.cursor() as cur:  # append-only: back-date through SQL, test only
        cur.execute(
            f"UPDATE {AuditEvent._meta.db_table} SET created_at = %s WHERE id = %s",
            [timezone.now() - timedelta(days=3), old.pk],
        )
    record(admin, "test.new", admin, {"n": 2})
    t = today.isoformat()
    got = {e["action"] for e in rows(admin_c, **{"from": t, "to": t})["data"]}
    assert "test.new" in got and "test.old" not in got
    d = (today - timedelta(days=3)).isoformat()
    assert {e["action"] for e in rows(admin_c, **{"from": d, "to": d})["data"]} == {"test.old"}


def test_pagination(admin_c, admin):
    for i in range(25):
        record(admin, "test.page", admin, {"i": i})
    first = rows(admin_c, action="test.page", page_size=10)
    assert len(first["data"]) == 10 and first["meta"]["total_count"] == 25
    last = rows(admin_c, action="test.page", page_size=10, page=3)
    assert len(last["data"]) == 5


@pytest.mark.parametrize(
    "params",
    [
        {"actor_id": "nope"},
        {"entity_id": "123"},
        {"from": "garbage"},
        {"from": "0001-01-01"},
        {"from": "2026-11-10", "to": "2026-11-01"},
    ],
)
def test_bad_params_are_400(admin_c, params):
    assert admin_c.get(URL, params).status_code == 400


def test_other_cafe_events_never_appear(admin_c, admin2_c, history):
    assert rows(admin2_c)["data"] == []
    assert rows(admin2_c, entity_id=history["order_id"])["data"] == []
    assert rows(admin_c)["meta"]["total_count"] > 0


def test_read_only(admin_c):
    for method in ("post", "patch", "put", "delete"):
        assert getattr(admin_c, method)(URL, {}, format="json").status_code == 405


def test_no_secret_in_any_recorded_summary(admin_c, history):
    """Spec 5.6: walk every event the flows above wrote."""
    banned = {"password", "new_password", "token", "csrf", "csrftoken", "sessionid", "secret"}

    def keys(o):
        if isinstance(o, dict):
            for k, v in o.items():
                yield k.lower()
                yield from keys(v)
        elif isinstance(o, list):
            for v in o:
                yield from keys(v)

    for e in AuditEvent.objects.all():
        assert not banned & set(keys(e.summary)), e.action


def test_rows_carry_readable_names_for_records_and_ids(admin_c, history, shop):
    """Readable audit log (owner, 2026-11-11): the viewer shows names, never bare ids."""
    from apps.inventory.services import adjust_stock

    adjust_stock(
        history["admin"],
        ingredient_id=shop.ing["Cup"].pk,
        mode="delta",
        reason="Broken",
        qty_delta="-2",
    )
    body = rows(admin_c)
    names = body["meta"]["names"]
    by_action = {e["action"]: e for e in body["data"]}
    order = by_action["order.created"]
    assert order["entity_label"] == order["summary"]["invoice_no"]
    refund = by_action["refund.created"]
    assert (
        refund["entity_label"] == refund["summary"]["invoice_no"]
    )  # a refund reads as its invoice
    assert names[refund["summary"]["original_cashier_id"]] == history["barista"].display_name or (
        history["barista"].username
    )
    assert names[order["summary"]["shift_id"]].startswith(
        history["barista"].display_name or history["barista"].username
    )
    stock = by_action["stock.adjusted"]
    assert names[stock["summary"]["ingredient_id"]] == "Cup"


def test_names_never_come_from_another_cafe(admin2_c, admin2, history):
    """An id that belongs to another café is not resolved (no leak through the names map)."""
    record(admin2, "test.foreign", admin2, {"order_id": history["order_id"]})
    body = rows(admin2_c, action="test.foreign")
    assert history["order_id"] not in body["meta"]["names"]


def test_every_recorded_action_has_a_readable_text_in_both_languages():
    """Every action string the code records must have an English and an Arabic title and sentence
    in the frontend, so the audit log never shows a technical name."""
    import json
    import re
    from pathlib import Path

    apps = Path(__file__).resolve().parents[2]
    # Repo checkout (CI) or the read-only mount in docker-compose.yml (local Docker).
    i18n = next(
        (
            p
            for p in (apps.parent.parent / "frontend/src/i18n", Path("/frontend/src/i18n"))
            if p.exists()
        ),
        None,
    )
    if i18n is None:  # backend-only checkout
        pytest.skip("frontend translations not present")
    pattern = re.compile(
        r'"([a-z_]+\.(?:created|updated|replaced|deleted|posted|voided|opened|'
        r"closed|adjusted|counted|opening_balance|deactivated|reactivated|"
        r'password_reset|modifier_groups_replaced))"'
    )
    actions = set()
    for f in apps.rglob("*.py"):
        if "tests" in f.parts or "migrations" in f.parts:
            continue
        actions |= set(pattern.findall(f.read_text()))
    assert "order.created" in actions and "settings.updated" in actions  # the scan works
    for lang in ("en", "ar"):
        audit = json.loads((i18n / f"{lang}.json").read_text())["audit"]
        missing = sorted(a for a in actions if not audit["actions"].get(a.replace(".", "_")))
        assert not missing, f"{lang}.json audit.actions lacks {missing}"
        missing = sorted(a for a in actions if not audit["sentences"].get(a.replace(".", "_")))
        assert not missing, f"{lang}.json audit.sentences lacks {missing}"
