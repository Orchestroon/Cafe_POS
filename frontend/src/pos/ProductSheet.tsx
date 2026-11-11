import { useState } from "react";
import { useTranslation } from "react-i18next";
import { needsRecipe, type LinkedGroup, type Product } from "../api/types";
import { Modal } from "../components/Modal";
import { Kbd } from "../components/ShortcutsHelp";
import { digitIndex } from "../lib/shortcuts";
import { formatMoney } from "../i18n/format";
import { newKey } from "../lib/uuid";
import { optionPrice, type CartLine } from "./cart";

export function ProductSheet({ product, line, currency, onAdd, onClose }: { product: Product; line?: CartLine; currency: string; onAdd: (l: CartLine) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const variants = product.variants.filter((v) => v.is_active);
  const groups = product.modifier_groups.filter((g) => g.is_active && g.options.some((o) => o.is_active));
  const [variantId, setVariantId] = useState(line?.variantId ?? variants.find((v) => !needsRecipe(v))?.id ?? "");
  const [chosen, setChosen] = useState<string[]>(line?.optionIds ?? []);
  const [qty, setQty] = useState(line?.quantity ?? 1);
  const variant = variants.find((v) => v.id === variantId && !needsRecipe(v));

  const countIn = (g: LinkedGroup) => g.options.filter((o) => chosen.includes(o.id)).length;
  const toggle = (g: LinkedGroup, id: string) => {
    if (g.max_select === 1) {
      const others = g.options.map((o) => o.id);
      // radio: picking one clears the others; picking the selected one again clears it (if optional)
      setChosen(chosen.includes(id) ? (g.min_select === 0 ? chosen.filter((c) => c !== id) : chosen) : [...chosen.filter((c) => !others.includes(c)), id]);
    } else if (chosen.includes(id)) setChosen(chosen.filter((c) => c !== id));
    else if (countIn(g) < g.max_select) setChosen([...chosen, id]);
  };
  const missing = groups.find((g) => countIn(g) < g.min_select);

  const add = () => {
    if (!variant || missing) return;
    const optionIds = groups.flatMap((g) => g.options.filter((o) => chosen.includes(o.id)).map((o) => o.id));
    onAdd({ id: line?.id ?? newKey(), variantId: variant.id, productId: product.id, productName: product.name, variantLabel: variant.label, quantity: qty, optionIds });
  };

  const shortcuts = {
    size: (e: KeyboardEvent) => {
      const v = variants[digitIndex(e)];
      if (!v || needsRecipe(v)) return false;
      setVariantId(v.id);
    },
    addToCart: () => (variant && !missing ? add() : false), // Space still toggles a focused option
  };
  return (
    <Modal title={product.name} onClose={onClose} shortcuts={shortcuts} footer={<><button className="btn btn-outline" onClick={onClose}>{t("common.cancel")}</button><button className="btn btn-primary" disabled={!variant || !!missing} onClick={add}>{line ? t("pos.update") : t("pos.addToCart")}<Kbd k="Enter" /></button></>}>
      <div className="sheet-section">
        <div className="sheet-title">{t("pos.size")}</div>
        <div className="choice-grid" role="radiogroup" aria-label={t("pos.size")}>
          {variants.map((v) => (
            <button key={v.id} role="radio" aria-checked={v.id === variantId} disabled={needsRecipe(v)} title={needsRecipe(v) ? t("pos.noRecipe") : undefined} className={`choice${v.id === variantId ? " selected" : ""}`} onClick={() => setVariantId(v.id)}>
              <span>{v.label}</span><span className="choice-price">{needsRecipe(v) ? t("pos.noRecipe") : formatMoney(v.price, currency)}</span>
            </button>
          ))}
        </div>
      </div>
      {groups.map((g) => (
        <div className="sheet-section" key={g.group_id}>
          <div className="sheet-title">{g.name} <span className="form-hint">{g.min_select > 0 ? t("pos.required") : t("pos.optional")}{g.max_select > 1 ? ` · ${t("pos.upTo", { count: g.max_select })}` : ""}</span></div>
          <div className="choice-grid" role={g.max_select === 1 ? "radiogroup" : "group"} aria-label={g.name}>
            {g.options.filter((o) => o.is_active).map((o) => {
              const on = chosen.includes(o.id);
              const price = variant ? optionPrice(o, variant.id) : o.price_delta;
              return (
                <button key={o.id} role={g.max_select === 1 ? "radio" : "checkbox"} aria-checked={on} className={`choice${on ? " selected" : ""}`} onClick={() => toggle(g, o.id)}>
                  <span>{o.label}</span><span className="choice-price">{price !== "0.00" ? `+${price}` : ""}</span>
                </button>
              );
            })}
          </div>
          {countIn(g) < g.min_select && <div className="field-error">{t("pos.chooseAtLeast", { count: g.min_select })}</div>}
        </div>
      ))}
      <div className="sheet-section">
        <div className="sheet-title">{t("pos.quantity")}</div>
        <Stepper value={qty} onChange={setQty} />
      </div>
    </Modal>
  );
}

export function Stepper({ value, onChange, disabled = false }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="stepper">
      <button className="btn btn-outline" aria-label={t("pos.decrease")} disabled={disabled || value <= 1} onClick={() => onChange(value - 1)}>−</button>
      <span className="stepper-value" aria-live="polite">{value}</span>
      <button className="btn btn-outline" aria-label={t("pos.increase")} disabled={disabled || value >= 99} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}
