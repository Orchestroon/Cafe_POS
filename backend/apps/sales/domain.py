"""Plain data the pure pricing and consumption engines work on. Built from the database by
`loader.py`; the engines never touch the database (spec 8.1, 8.2)."""

from dataclasses import dataclass, field
from decimal import Decimal
from uuid import UUID


@dataclass(frozen=True)
class GroupData:
    id: UUID
    name: str
    mode: str  # "add" | "replace"
    replacement_slot: str | None
    min_select: int
    max_select: int
    is_active: bool


@dataclass(frozen=True)
class EffectData:
    variant_id: UUID | None  # None = applies to all sizes
    ingredient_id: UUID
    ingredient_name: str
    unit: str
    base_qty: Decimal
    waste_pct: Decimal


@dataclass(frozen=True)
class OptionData:
    id: UUID
    label: str
    group_id: UUID
    is_active: bool
    price_delta: Decimal
    variant_prices: dict[UUID, Decimal] = field(default_factory=dict)
    effects: tuple[EffectData, ...] = ()


@dataclass(frozen=True)
class RecipeLineData:
    ingredient_id: UUID
    ingredient_name: str
    unit: str
    base_qty: Decimal
    waste_pct: Decimal
    slot_key: str | None


@dataclass(frozen=True)
class VariantData:
    id: UUID
    label: str
    price: Decimal
    is_active: bool
    product_id: UUID
    product_name: str
    product_is_active: bool
    category_is_active: bool
    linked_groups: tuple[GroupData, ...] = ()  # in display order
    recipe: tuple[RecipeLineData, ...] = ()

    @property
    def sellable(self) -> bool:
        return self.is_active and self.product_is_active and self.category_is_active


@dataclass(frozen=True)
class TaxConfig:
    enabled: bool = False
    rate: Decimal = Decimal("0.00")
    inclusive: bool = False
    label: str = "VAT"

    def snapshot(self) -> dict:
        return {
            "enabled": self.enabled,
            "rate": str(self.rate),
            "inclusive": self.inclusive,
            "label": self.label,
        }


@dataclass(frozen=True)
class ItemRequest:
    variant_id: UUID
    quantity: int
    option_ids: tuple[UUID, ...] = ()


@dataclass(frozen=True)
class PricedItem:
    request: ItemRequest
    variant: VariantData
    options: tuple[OptionData, ...]  # selected options, in request order
    unit_price: Decimal
    unit_discount: Decimal
    line_subtotal: Decimal
    line_discount: Decimal
    line_total: Decimal
    modifiers: tuple[dict, ...]  # modifiers_snapshot rows


@dataclass(frozen=True)
class PricedOrder:
    items: tuple[PricedItem, ...]
    subtotal: Decimal
    discount_total: Decimal
    tax_total: Decimal
    total: Decimal
    tax: TaxConfig
