import type { Product } from "../api/types";

export interface CartLine {
  id: string;
  variantId: string;
  productId: string;
  productName: string;
  variantLabel: string;
  quantity: number;
  optionIds: string[];
}

// Keys are per user: on a shared tablet the next cashier never sees (or retries) another
// cashier's cart or unconfirmed sale. The previous cashier gets them back on their next login.
const cartKey = (userId: string) => `pos.cart.${userId}`;
const pendingKey = (userId: string) => `pos.pending.${userId}`;

// sessionStorage is a convenience backup only: every access is guarded (private mode, blocked data).
const read = <T,>(key: string): T | null => {
  try {
    const v = sessionStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};
const write = (key: string, value: unknown) => {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
};

export const loadCart = (userId: string) => read<CartLine[]>(cartKey(userId)) ?? [];
export const saveCart = (userId: string, c: CartLine[]) => write(cartKey(userId), c.length ? c : null);

/** A checkout that has not received a definitive answer yet. Retried with the SAME key (spec 10.2). */
export interface PendingCheckout {
  key: string;
  payload: {
    items: { variant_id: string; quantity: number; modifier_option_ids: string[] }[];
    payments: Record<string, string>[];
    expected_total: string;
  };
}
export const loadPending = (userId: string) => read<PendingCheckout>(pendingKey(userId));
export const savePending = (userId: string, p: PendingCheckout | null) => write(pendingKey(userId), p);

export const toApiItems = (cart: CartLine[]) =>
  cart.map((l) => ({ variant_id: l.variantId, quantity: l.quantity, modifier_option_ids: l.optionIds }));

/** Price of an option for one size: that size's override if any, else the option's own price. */
export function optionPrice(opt: { price_delta: string; variant_prices: { variant_id: string; price_delta: string }[] }, variantId: string) {
  return opt.variant_prices.find((p) => p.variant_id === variantId)?.price_delta ?? opt.price_delta;
}

export const sellableProducts = (products: Product[]) =>
  products.filter((p) => p.is_active && p.variants.some((v) => v.is_active));
