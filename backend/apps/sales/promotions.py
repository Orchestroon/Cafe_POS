"""Promotion engine (spec 8.12). Pure: no database access. Money is handled in whole cents.

Rule: **no stacking, the best deal wins.** A cart unit is covered by at most one promotion.
1. Item promotions (a size or a category): each unit gets the largest discount that fits.
2. Combos then claim units (highest base price first) when the bundle beats the item discounts
   those units already had. The combo discount is spread over the lines it used.
3. An order-wide promotion is an alternative to 1 and 2, never added to them: whichever gives the
   cart the larger total discount wins as a whole (a tie keeps the line-level result).
Item and category promotions and combos use the size's base price only (extras are charged in
full); an order-wide promotion uses the whole subtotal. Ties between promotions: the earliest
created wins. Combo matching is greedy, not an optimal assignment (documented limit)."""

from dataclasses import replace
from decimal import Decimal

from apps.core.money import q_money

from .domain import PricedItem, PromotionData


def _cents(d: Decimal) -> int:
    return int(q_money(d) * 100)


def _money(c: int) -> Decimal:
    return q_money(Decimal(c) / 100)


def allocate(total: int, weights: list[int]) -> list[int]:
    """Split `total` cents over `weights` (largest remainder, ties to the lower index). Each share
    is at most its weight when total <= sum(weights), so a line never goes below zero."""
    s = sum(weights)
    if total <= 0 or s <= 0:
        return [0] * len(weights)
    shares = [total * w // s for w in weights]
    left = total - sum(shares)
    for i in sorted(range(len(weights)), key=lambda i: (-(total * weights[i] % s), i))[:left]:
        shares[i] += 1
    return shares


def _rank(p: PromotionData):
    return (p.created_at, str(p.id))


def _unit_discount(p: PromotionData, price: Decimal) -> int:
    if p.discount_type == "percentage":
        return _cents(price * p.value / 100)
    return _cents(min(p.value, price))


def _fits(p: PromotionData, variant) -> bool:
    if p.scope == "variant":
        return variant.id in p.variant_ids
    return p.scope == "category" and variant.category_id in p.category_ids


def _slot_fits(slot, variant) -> bool:
    return variant.id in slot.variant_ids or (
        slot.category_id is not None and variant.category_id == slot.category_id
    )


def _build_instance(combo, rem, items, by_price):
    """One bundle from the units still free: {line index: units}, or None when it does not fit."""
    rem, take = list(rem), {}
    for slot in combo.slots:
        need = slot.quantity
        for i in by_price:
            if need == 0:
                break
            if rem[i] > 0 and _slot_fits(slot, items[i].variant):
                n = min(rem[i], need)
                rem[i] -= n
                take[i] = take.get(i, 0) + n
                need -= n
        if need:
            return None
    return take


def evaluate(items: list[PricedItem], promos, selected=frozenset()):
    """Returns one list per line of (promotion, cents) allocations. `promos` are the live ones;
    a promotion that is not auto_apply counts only when its id is in `selected`."""
    pool = sorted(
        (p for p in promos if p.auto_apply or p.id in selected), key=_rank
    )  # earliest first, so a strict ">" keeps the earliest on a tie
    n = len(items)
    base = [_cents(it.variant.price) for it in items]
    qty = [it.request.quantity for it in items]
    unit_disc, unit_promo = [0] * n, [None] * n
    for i, it in enumerate(items):
        for p in pool:
            if p.kind == "discount" and p.scope != "order" and _fits(p, it.variant):
                d = _unit_discount(p, it.variant.price)
                if d > unit_disc[i]:
                    unit_disc[i], unit_promo[i] = d, p
    claimed, combo_alloc = [0] * n, [[] for _ in range(n)]
    free = list(qty)
    by_price = sorted(range(n), key=lambda i: (-base[i], i))
    combos = [p for p in pool if p.kind == "combo"]
    while True:
        best = None
        for c in combos:
            take = _build_instance(c, free, items, by_price)
            if not take:
                continue
            gross = sum(k * base[i] for i, k in take.items())
            d = gross - _cents(c.combo_price)
            gain = d - sum(k * unit_disc[i] for i, k in take.items())
            if d > 0 and gain > 0 and (best is None or gain > best[0]):
                best = (gain, c, take, d)
        if best is None:
            break
        _, c, take, d = best
        times = min(free[i] // k for i, k in take.items())  # identical bundles in one go
        lines = sorted(take)
        shares = allocate(d, [take[i] * base[i] for i in lines])
        for i, share in zip(lines, shares, strict=True):
            free[i] -= take[i] * times
            claimed[i] += take[i] * times
            combo_alloc[i].append((c, share * times))
    line_level = sum(unit_disc[i] * (qty[i] - claimed[i]) for i in range(n)) + sum(
        a for lst in combo_alloc for _, a in lst
    )
    subtotal = [_cents(it.line_subtotal) for it in items]
    order_best, order_cents = None, 0
    for p in pool:
        if p.kind == "discount" and p.scope == "order":
            total = sum(subtotal)
            if p.discount_type == "percentage":
                d = _cents(Decimal(total) / 100 * p.value / 100)
            else:
                d = min(_cents(p.value), total)
            if d > order_cents:
                order_best, order_cents = p, d
    if order_cents > line_level:
        return [[(order_best, a)] if a else [] for a in allocate(order_cents, subtotal)]
    out = []
    for i in range(n):
        rows = list(combo_alloc[i])
        left = qty[i] - claimed[i]
        if unit_promo[i] is not None and left:
            rows.insert(0, (unit_promo[i], unit_disc[i] * left))
        out.append([(p, a) for p, a in rows if a > 0])
    return out


def _total(allocs) -> int:
    return sum(a for row in allocs for _, a in row)


def apply(items: list[PricedItem], promos, selected=frozenset()):
    """Returns (items with their discount filled in, [applied promotions])."""
    allocs = evaluate(items, promos, selected)
    out, applied = [], {}
    for it, row in zip(items, allocs, strict=True):
        cents = sum(a for _, a in row)
        discount = _money(cents)
        for p, a in row:
            hit = applied.setdefault(
                p.id,
                {
                    "id": str(p.id),
                    "name": p.name,
                    "kind": p.kind,
                    "amount": 0,
                    "manual": not p.auto_apply,
                },
            )
            hit["amount"] += a
        out.append(
            replace(
                it,
                unit_discount=q_money(discount / it.request.quantity),
                line_discount=discount,
                line_total=q_money(it.line_subtotal - discount),
                promotions=tuple(
                    {
                        "promotion_id": str(p.id),
                        "name": p.name,
                        "kind": p.kind,
                        "amount": str(_money(a)),
                    }
                    for p, a in row
                ),
            )
        )
    return out, tuple({**h, "amount": _money(h["amount"])} for h in applied.values())


def selectable(items: list[PricedItem], promos, selected=frozenset()) -> tuple[dict, ...]:
    """Promotions the cashier may tap: those that are not automatic. A tapped one is listed with
    `selected` and `gain` (what it adds to the cart's total discount, 0 = another deal is better);
    an untapped one is listed only when tapping it would help."""
    manual = sorted((p for p in promos if not p.auto_apply), key=lambda p: (p.name, str(p.id)))
    if not manual:
        return ()
    now = _total(evaluate(items, promos, selected))
    rows = []
    for p in manual:
        if p.id in selected:
            gain = now - _total(evaluate(items, promos, selected - {p.id}))
        else:
            gain = _total(evaluate(items, promos, selected | {p.id})) - now
            if gain <= 0:
                continue
        rows.append(
            {
                "id": str(p.id),
                "name": p.name,
                "kind": p.kind,
                "selected": p.id in selected,
                "gain": _money(gain),
            }
        )
    return tuple(rows)
