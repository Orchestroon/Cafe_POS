from decimal import Decimal

from django.db.models import Sum

from .models import Expense


def drawer_total(shift) -> Decimal:
    """Posted (not voided) expenses paid from this shift's drawer."""
    total = Expense.objects.filter(
        shift=shift, source=Expense.Source.CASH_DRAWER, status=Expense.Status.POSTED
    ).aggregate(t=Sum("amount"))["t"]
    return total or Decimal("0.00")
