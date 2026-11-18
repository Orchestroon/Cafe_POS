import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Product } from "../api/types";
import { formatMoney } from "../i18n/format";

/** Choose sizes from the whole menu: search, one box per size, one per product for all its sizes. */
export function VariantPicker({ products, value, onChange, currency, error }: { products: Product[]; value: string[]; onChange: (ids: string[]) => void; currency: string; error?: string }) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter((p) => !needle || p.name.toLowerCase().includes(needle));
  }, [products, q]);
  const picked = new Set(value);
  const toggle = (ids: string[], on: boolean) => onChange(on ? [...new Set([...value, ...ids])] : value.filter((v) => !ids.includes(v)));
  return (
    <div className="picker">
      <input className="form-input" type="search" placeholder={t("promos.searchSizes")} aria-label={t("promos.searchSizes")} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="picker-list" role="group">
        {shown.length === 0 && <div className="form-hint">{t("common.empty")}</div>}
        {shown.map((p) => {
          const ids = p.variants.map((v) => v.id);
          const all = ids.every((id) => picked.has(id));
          return (
            <div key={p.id} className="picker-group">
              <label className="check-row picker-product"><input type="checkbox" checked={all} onChange={(e) => toggle(ids, e.target.checked)} /> {p.name}{!p.is_active && <span className="badge badge-off">{t("common.inactive")}</span>}</label>
              <div className="picker-sizes">
                {p.variants.map((v) => (
                  <label key={v.id} className="check-row"><input type="checkbox" checked={picked.has(v.id)} onChange={(e) => toggle([v.id], e.target.checked)} /> {v.label} <span className="form-hint">{formatMoney(v.price, currency)}</span></label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="form-hint">{t("promos.picked", { count: value.length })}</div>
      {error && <div className="field-error" role="alert">{error}</div>}
    </div>
  );
}
