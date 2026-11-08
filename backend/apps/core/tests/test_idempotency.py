import uuid
from types import SimpleNamespace

import pytest

from apps.core import idempotency as idem
from apps.core.exceptions import ApiError
from apps.core.models import IdempotencyRecord

pytestmark = pytest.mark.django_db


def req(key):
    return SimpleNamespace(headers={"Idempotency-Key": key} if key else {})


def test_key_required_and_must_be_uuid():
    for bad in (None, "", "not-a-uuid"):
        with pytest.raises(ApiError) as e:
            idem.parse_key(req(bad))
        assert e.value.code == "IDEMPOTENCY_KEY_REQUIRED" and e.value.status == 400
    k = uuid.uuid4()
    assert idem.parse_key(req(str(k))) == k


def run(org, user, key, payload, calls, scope="checkout", fail=False):
    def handler():
        calls.append(1)
        if fail:
            raise RuntimeError("boom")
        return 201, {"order": len(calls)}

    return idem.run_idempotent(
        organization=org, user=user, scope=scope, key=key, payload=payload, handler=handler
    )


def test_replay_returns_stored_response_without_rerunning(org, admin):
    key, calls = uuid.uuid4(), []
    first = run(org, admin, key, {"a": 1, "b": 2}, calls)
    again = run(org, admin, key, {"b": 2, "a": 1}, calls)  # key order does not matter
    assert (first.status, first.body, first.replayed) == (201, {"order": 1}, False)
    assert (again.status, again.body, again.replayed) == (201, {"order": 1}, True)
    assert again.headers() == {"Idempotent-Replayed": "true"} and first.headers() == {}
    assert len(calls) == 1


def test_same_key_different_payload_conflicts(org, admin):
    key, calls = uuid.uuid4(), []
    run(org, admin, key, {"a": 1}, calls)
    with pytest.raises(ApiError) as e:
        run(org, admin, key, {"a": 2}, calls)
    assert e.value.code == "IDEMPOTENCY_CONFLICT" and e.value.status == 409


def test_same_key_other_scope_is_independent(org, admin):
    key, calls = uuid.uuid4(), []
    run(org, admin, key, {"a": 1}, calls, scope="checkout")
    run(org, admin, key, {"a": 1}, calls, scope="refund:1")
    assert len(calls) == 2


def test_failure_rolls_back_record_so_retry_with_same_key_works(org, admin):
    key, calls = uuid.uuid4(), []
    with pytest.raises(RuntimeError):
        run(org, admin, key, {"a": 1}, calls, fail=True)
    assert not IdempotencyRecord.objects.exists()
    ok = run(org, admin, key, {"a": 1}, calls)
    assert ok.status == 201 and not ok.replayed


def test_other_organization_does_not_see_record(org, org2, admin, admin2):
    key, calls = uuid.uuid4(), []
    run(org, admin, key, {"a": 1}, calls)
    run(org2, admin2, key, {"a": 1}, calls)
    assert len(calls) == 2


def test_lost_race_replays_winner(org, admin, monkeypatch):
    """Both requests passed the first lookup; the loser hits the unique index and replays."""
    key, calls = uuid.uuid4(), []
    run(org, admin, key, {"a": 1}, calls)
    real = idem._stored
    seen = []

    def stored(*a):
        seen.append(1)
        return None if len(seen) == 1 else real(*a)

    monkeypatch.setattr(idem, "_stored", stored)
    res = run(org, admin, key, {"a": 1}, calls)
    assert res.replayed and res.body == {"order": 1} and len(calls) == 1
