"""Idempotency for checkout / refund / purchase post (spec 5.3).

`run_idempotent` inserts the record inside the same transaction as the business write, so a failed
operation leaves nothing behind and the client may retry with the same key."""

import hashlib
import json
import uuid
from dataclasses import dataclass

from django.db import IntegrityError, transaction

from .exceptions import ApiError
from .models import IdempotencyRecord

HEADER = "Idempotency-Key"


@dataclass
class IdempotentResult:
    status: int
    body: dict
    replayed: bool

    def headers(self):
        return {"Idempotent-Replayed": "true"} if self.replayed else {}


def parse_key(request) -> uuid.UUID:
    raw = request.headers.get(HEADER)
    try:
        return uuid.UUID(raw)
    except (TypeError, ValueError, AttributeError):
        raise ApiError(
            "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key (UUID) header is required."
        ) from None


def request_hash(payload, scope: str) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256((canonical + scope).encode()).hexdigest()


def _stored(org, scope, key, digest) -> IdempotentResult | None:
    rec = IdempotencyRecord.objects.filter(organization=org, scope=scope, key=key).first()
    if rec is None:
        return None
    if rec.request_hash != digest:
        raise ApiError(
            "IDEMPOTENCY_CONFLICT", "This Idempotency-Key was used with a different request.", 409
        )
    return IdempotentResult(rec.response_status, rec.response_body, True)


def run_idempotent(*, organization, user, scope, key, payload, handler) -> IdempotentResult:
    """handler() runs inside the atomic block and returns (status, body_dict)."""
    digest = request_hash(payload, scope)
    if (hit := _stored(organization, scope, key, digest)) is not None:
        return hit
    try:
        with transaction.atomic():
            rec = IdempotencyRecord.objects.create(
                organization=organization, scope=scope, key=key, request_hash=digest, user=user
            )
            status, body = handler()
            rec.response_status, rec.response_body = status, body
            rec.save(update_fields=["response_status", "response_body", "updated_at"])
            return IdempotentResult(status, body, False)
    except IntegrityError:
        # Lost a race against the same key: the winner has committed, so replay its response.
        if (hit := _stored(organization, scope, key, digest)) is not None:
            return hit
        raise
