from django.urls import include, path
from rest_framework.routers import SimpleRouter

from apps.accounts.views import UserViewSet
from apps.catalog.views import CategoryViewSet, ProductViewSet, VariantViewSet
from apps.inventory import views as inv
from apps.modifiers.views import ModifierGroupViewSet, ModifierOptionViewSet
from apps.sales import views as sales
from apps.shifts import views as shifts
from apps.tenancy.views import SettingsView

from . import views

router = SimpleRouter(trailing_slash=False)
router.register("users", UserViewSet, basename="user")
router.register("categories", CategoryViewSet, basename="category")
router.register("products", ProductViewSet, basename="product")
router.register("variants", VariantViewSet, basename="variant")
router.register("modifier-groups", ModifierGroupViewSet, basename="modifier-group")
router.register("modifier-options", ModifierOptionViewSet, basename="modifier-option")
router.register("orders", sales.OrderViewSet, basename="order")
router.register("ingredients", inv.IngredientViewSet, basename="ingredient")
router.register("inventory/balances", inv.BalanceViewSet, basename="balance")
router.register("inventory/movements", inv.MovementViewSet, basename="movement")

urlpatterns = [
    path("health", views.health),
    path("", include("apps.accounts.urls")),
    path("settings", SettingsView.as_view()),
    path("orders/checkout", sales.CheckoutView.as_view()),
    path("orders/quote", sales.QuoteView.as_view()),
    path("shifts/current", shifts.CurrentShiftView.as_view()),
    path("shifts/open", shifts.OpenShiftView.as_view()),
    path("inventory/adjustments", inv.AdjustmentView.as_view()),
    path("inventory/opening-balances", inv.OpeningBalancesView.as_view()),
    path("", include(router.urls)),
]
