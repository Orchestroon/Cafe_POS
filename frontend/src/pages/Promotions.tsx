import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { Category, ComboSlot, Product, Promotion, PromotionInput, PromotionKind, PromotionScope, VariantCost } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Check, Field, fieldError, isDecimal, TextField } from "../components/Form";
import { Drawer } from "../components/Drawer";
import { PageHeader } from "../components/PageHeader";
import { MenuTabs } from "../components/SectionTabs";
import { Kbd } from "../components/ShortcutsHelp";
import { ErrorBanner } from "../components/States";
import { ListState } from "../components/Table";
import { VariantPicker } from "../components/VariantPicker";
import { formatMoney } from "../i18n/format";
import { belowCost } from "../lib/promoCost";
import { dayName, whatText, whenText, type Names } from "../lib/promoText";

const BLANK: PromotionInput = {
  name: "", kind: "discount", is_active: true, auto_apply: true, scope: "variant", discount_type: "percentage", discount_value: "10.00",
  variant_ids: [], category_ids: [], combo_price: null, slots: [], starts_on: null, ends_on: null, days_of_week: [], window_start: null, window_end: null,
};

/** Names for the summaries: sizes as "Latte (Small)", categories by name. */
function useNames(): { names: Names; products: Product[]; cats: Category[]; loading: boolean } {
  const { me } = useAuth();
  const { i18n } = useTranslation();
  const products = useQuery({ queryKey: ["products", "all"], queryFn: () => api.all<Product>("/products", { ordering: "sort_order" }) });
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => api.all<Category>("/categories", { ordering: "sort_order" }) });
  const cur = me?.settings.currency ?? "";
  const names = useMemo<Names>(() => {
    const v = new Map<string, string>();
    products.data?.forEach((p) => p.variants.forEach((x) => v.set(x.id, `${p.name} (${x.label})`)));
    const c = new Map((cats.data ?? []).map((x) => [x.id, x.name]));
    return { variant: (id) => v.get(id) ?? "?", category: (id) => c.get(id) ?? "?", money: (m) => formatMoney(m, cur), locale: i18n.language };
  }, [products.data, cats.data, cur, i18n.language]);
  return { names, products: products.data ?? [], cats: cats.data ?? [], loading: products.isLoading || cats.isLoading };
}

export function Promotions() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Promotion | "new" | null>(null);
  const list = useQuery({ queryKey: ["promotions"], queryFn: () => api.all<Promotion>("/promotions", { ordering: "name" }) });
  const { names } = useNames();
  const toggle = useMutation({
    mutationFn: (p: Promotion) => api.patch<Promotion>(`/promotions/${p.id}`, { is_active: !p.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["promotions"] }),
  });
  return (
    <>
      <PageHeader title={t("nav.menuRecipes")} actions={<button className="btn btn-primary" data-shortcut="new" onClick={() => setEditing("new")}>{t("common.new")}<Kbd k="N" /></button>} />
      <MenuTabs />
      <p className="form-hint" style={{ marginBottom: 12 }}>{t("promos.intro")}</p>
      <ErrorBanner error={toggle.error} />
      <div className="card">
        <ListState loading={list.isLoading} error={list.error} empty={list.data?.length === 0}>
          <table className="erp-table">
            <thead><tr><th>{t("common.name")}</th><th>{t("promos.what")}</th><th>{t("promos.when")}</th><th>{t("promos.mode")}</th><th>{t("common.status")}</th><th /></tr></thead>
            <tbody>
              {list.data?.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong><div className="form-hint">{t(`promos.kinds.${p.kind}`)}</div></td>
                  <td className="wrap-cell">{whatText(t, p, names)}</td>
                  <td className="wrap-cell">{whenText(t, p, names)}</td>
                  <td>{p.auto_apply ? t("promos.auto") : t("promos.manual")}</td>
                  <td>
                    <span className={`badge ${p.status === "active" ? "badge-active" : p.status === "scheduled" ? "badge-pending" : "badge-off"}`}>{t(`promos.status.${p.status}`)}</span>
                    {p.status === "active" && <div className="form-hint">{p.live_now ? t("promos.liveNow") : t("promos.notNow")}</div>}
                  </td>
                  <td><div className="row-actions">
                    <button className="btn btn-outline btn-sm" disabled={toggle.isPending} onClick={() => toggle.mutate(p)}>{p.is_active ? t("promos.turnOff") : t("promos.turnOn")}</button>
                    <button className="btn btn-outline btn-sm" onClick={() => setEditing(p)}>{t("common.edit")}</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ListState>
      </div>
      {editing && <PromotionForm initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function PromotionForm({ initial, onClose }: { initial: Promotion | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const cur = me?.settings.currency ?? "";
  const { names, products, cats } = useNames();
  const costs = useQuery({ queryKey: ["promotion-costs"], queryFn: () => api.get<VariantCost[]>("/promotions/variant-costs") });
  const [d, setD] = useState<PromotionInput>(() => (initial ? { ...BLANK, ...initial } : BLANK));
  const [useWindow, setUseWindow] = useState(!!initial?.window_start);
  const [clientErr, setClientErr] = useState<Record<string, string>>({});
  const set = <K extends keyof PromotionInput>(k: K, v: PromotionInput[K]) => setD((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const combo = d.kind === "combo";
      const body: PromotionInput = {
        ...d,
        name: d.name.trim(),
        scope: combo ? "" : d.scope, discount_type: combo ? "" : d.discount_type, discount_value: combo ? null : d.discount_value,
        variant_ids: !combo && d.scope === "variant" ? d.variant_ids : [], category_ids: !combo && d.scope === "category" ? d.category_ids : [],
        combo_price: combo ? d.combo_price : null, slots: combo ? d.slots : [],
        window_start: useWindow ? d.window_start : null, window_end: useWindow ? d.window_end : null,
      };
      return initial ? api.patch<Promotion>(`/promotions/${initial.id}`, body) : api.post<Promotion>("/promotions", body);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["promotions"] }); onClose(); },
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (!d.name.trim()) e.name = t("promos.errName");
    if (d.kind === "discount" && !isDecimal(d.discount_value ?? "", 2)) e.discount_value = t("common.decimalInvalid");
    if (d.kind === "combo" && !isDecimal(d.combo_price ?? "", 2)) e.combo_price = t("common.decimalInvalid");
    if (useWindow && (!d.window_start || !d.window_end)) e.window_end = t("promos.errWindow");
    setClientErr(e);
    if (Object.keys(e).length === 0) save.mutate();
  };
  const err = (k: string) => clientErr[k] ?? fieldError(save.error, k);

  const check = useMemo(() => belowCost(
    { kind: d.kind, scope: d.scope, discountType: d.discount_type, value: d.discount_value ?? "", variantIds: d.variant_ids, categoryIds: d.category_ids, comboPrice: d.combo_price ?? "", slots: d.slots },
    costs.data ?? [],
  ), [d, costs.data]);
  const rowOf = (id: string) => costs.data?.find((r) => r.variant_id === id);
  const summary = d.kind === "combo" ? d.slots.length > 0 && isDecimal(d.combo_price ?? "", 2) : isDecimal(d.discount_value ?? "", 2);

  const dayOrder = i18n.language === "ar" ? [5, 6, 0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5, 6];
  const setSlot = (i: number, patch: Partial<ComboSlot>) => set("slots", d.slots.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  return (
    <Drawer title={initial ? t("promos.edit") : t("promos.new")} onClose={onClose} wide>
      <ErrorBanner error={save.error} />
      <TextField label={t("common.name")} value={d.name} onChange={(e) => set("name", e.target.value)} error={err("name")} autoFocus />
      <div className="form-grid">
        <Field label={t("promos.kind")}>
          <select className="form-input" value={d.kind} onChange={(e) => set("kind", e.target.value as PromotionKind)}>
            <option value="discount">{t("promos.kinds.discount")}</option>
            <option value="combo">{t("promos.kinds.combo")}</option>
          </select>
        </Field>
        <div>
          <Check label={t("promos.autoApply")} checked={d.auto_apply} onChange={(v) => set("auto_apply", v)} />
          <Check label={t("common.active")} checked={d.is_active} onChange={(v) => set("is_active", v)} />
        </div>
      </div>
      <p className="form-hint" style={{ marginBottom: 12 }}>{d.auto_apply ? t("promos.autoHint") : t("promos.manualHint")}</p>

      {d.kind === "discount" ? (
        <fieldset className="promo-section">
          <legend>{t("promos.discountTitle")}</legend>
          <div className="form-grid">
            <Field label={t("promos.scope")} error={err("scope")}>
              <select className="form-input" value={d.scope} onChange={(e) => set("scope", e.target.value as PromotionScope)}>
                {(["variant", "category", "order"] as const).map((s) => <option key={s} value={s}>{t(`promos.scopes.${s}`)}</option>)}
              </select>
            </Field>
            <Field label={t("promos.discountType")} error={err("discount_type")}>
              <select className="form-input" value={d.discount_type} onChange={(e) => set("discount_type", e.target.value as PromotionInput["discount_type"])}>
                <option value="percentage">{t("promos.types.percentage")}</option>
                <option value="fixed_amount">{t("promos.types.fixed_amount", { currency: cur })}</option>
              </select>
            </Field>
            <TextField label={d.discount_type === "percentage" ? t("promos.valuePct") : `${t("promos.valueAmount")} (${cur})`} inputMode="decimal" value={d.discount_value ?? ""} onChange={(e) => set("discount_value", e.target.value)} error={err("discount_value")} />
          </div>
          <p className="form-hint">{d.scope === "order" ? t("promos.scopeHintOrder") : t("promos.scopeHintBase")}</p>
          {d.scope === "variant" && <VariantPicker products={products} value={d.variant_ids} onChange={(v) => set("variant_ids", v)} currency={cur} error={err("variant_ids")} />}
          {d.scope === "category" && (
            <div className="picker-list" role="group">
              {cats.map((c) => <Check key={c.id} label={c.name} checked={d.category_ids.includes(c.id)} onChange={(on) => set("category_ids", on ? [...d.category_ids, c.id] : d.category_ids.filter((x) => x !== c.id))} />)}
              {err("category_ids") && <div className="field-error" role="alert">{err("category_ids")}</div>}
            </div>
          )}
        </fieldset>
      ) : (
        <fieldset className="promo-section">
          <legend>{t("promos.comboTitle")}</legend>
          <TextField label={`${t("promos.comboPrice")} (${cur})`} inputMode="decimal" value={d.combo_price ?? ""} onChange={(e) => set("combo_price", e.target.value)} error={err("combo_price")} hint={t("promos.comboHint")} />
          {d.slots.map((s, i) => (
            <div className="promo-slot" key={i}>
              <div className="promo-slot-head">
                <strong>{t("promos.part", { n: i + 1 })}</strong>
                <button className="btn btn-outline btn-sm" onClick={() => set("slots", d.slots.filter((_, n) => n !== i))}>{t("common.remove")}</button>
              </div>
              <div className="form-grid">
                <TextField label={t("promos.qty")} type="number" min={1} max={20} value={s.quantity} onChange={(e) => setSlot(i, { quantity: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} />
                <Field label={t("promos.partFrom")}>
                  <select className="form-input" value={s.category_id ? "category" : "sizes"} onChange={(e) => setSlot(i, e.target.value === "category" ? { category_id: cats[0]?.id ?? null, variant_ids: [] } : { category_id: null })}>
                    <option value="category">{t("promos.anyOfCategory")}</option>
                    <option value="sizes">{t("promos.specificSizes")}</option>
                  </select>
                </Field>
              </div>
              {s.category_id !== null ? (
                <select className="form-input" aria-label={t("promos.pickCategory")} value={s.category_id} onChange={(e) => setSlot(i, { category_id: e.target.value })}>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              ) : <VariantPicker products={products} value={s.variant_ids} onChange={(v) => setSlot(i, { variant_ids: v })} currency={cur} />}
            </div>
          ))}
          {err("slots") && <div className="field-error" role="alert">{err("slots")}</div>}
          <button className="btn btn-outline btn-sm" disabled={d.slots.length >= 6} onClick={() => set("slots", [...d.slots, { quantity: 1, category_id: cats[0]?.id ?? null, variant_ids: [] }])}>{t("promos.addPart")}</button>
        </fieldset>
      )}

      <fieldset className="promo-section">
        <legend>{t("promos.scheduleTitle")}</legend>
        <div className="form-grid">
          <TextField label={t("promos.startsOn")} type="date" value={d.starts_on ?? ""} onChange={(e) => set("starts_on", e.target.value || null)} error={err("starts_on")} />
          <TextField label={t("promos.endsOn")} type="date" value={d.ends_on ?? ""} onChange={(e) => set("ends_on", e.target.value || null)} error={err("ends_on")} />
        </div>
        <div className="form-label" style={{ marginBottom: 6 }}>{t("promos.days")}</div>
        <div className="day-chips" role="group" aria-label={t("promos.days")}>
          {dayOrder.map((n) => {
            const on = d.days_of_week.includes(n);
            return <button key={n} type="button" aria-pressed={on} className={`promo-chip${on ? " on" : ""}`} onClick={() => set("days_of_week", on ? d.days_of_week.filter((x) => x !== n) : [...d.days_of_week, n].sort())}>{dayName(n, i18n.language)}</button>;
          })}
        </div>
        <p className="form-hint">{t("promos.daysHint")}</p>
        <Check label={t("promos.useWindow")} checked={useWindow} onChange={(v) => { setUseWindow(v); if (v && !d.window_start) setD((x) => ({ ...x, window_start: "15:00", window_end: "17:00" })); }} />
        {useWindow && (
          <div className="form-grid">
            <TextField label={t("promos.windowFrom")} type="time" value={d.window_start ?? ""} onChange={(e) => set("window_start", e.target.value || null)} />
            <TextField label={t("promos.windowTo")} type="time" value={d.window_end ?? ""} onChange={(e) => set("window_end", e.target.value || null)} error={err("window_end")} hint={t("promos.windowHint")} />
          </div>
        )}
      </fieldset>

      {summary && (
        <div className="promo-preview" role="note">
          <strong>{t("promos.preview")}</strong>
          <div>{whatText(t, d, names)}</div>
          <div className="form-hint">{whenText(t, d, names)} · {d.auto_apply ? t("promos.auto") : t("promos.manual")}</div>
        </div>
      )}
      {check.warnings.length > 0 && (
        <div className="alert-banner alert-warning" role="alert" style={{ marginBottom: 12 }}>
          <strong>{t("promos.belowCost")}</strong>
          <ul style={{ margin: "4px 0 0", paddingInlineStart: 18 }}>
            {check.warnings.slice(0, 5).map((w, i) => (
              <li key={i}>{w.kind === "variant"
                ? t("promos.belowCostVariant", { name: names.variant(w.variantId), price: formatMoney(w.priceAfter, cur), cost: formatMoney(w.cost, cur), full: formatMoney(rowOf(w.variantId)?.price ?? "0.00", cur) })
                : t(w.level === "always" ? "promos.belowCostComboAlways" : "promos.belowCostComboMaybe", { price: formatMoney(w.price, cur), cost: formatMoney(w.cost, cur) })}</li>
            ))}
            {check.warnings.length > 5 && <li>{t("audit.more", { count: check.warnings.length - 5 })}</li>}
          </ul>
          <div className="form-hint">{t("promos.belowCostNote")}</div>
        </div>
      )}
      {check.unknown > 0 && <p className="form-hint" style={{ marginBottom: 12 }}>{t("promos.unknownCost", { count: check.unknown })}</p>}

      <div className="drawer-actions">
        <button className="btn btn-outline" onClick={onClose}>{t("common.cancel")}</button>
        <button className="btn btn-primary" disabled={save.isPending} onClick={submit}>{t("common.save")}</button>
      </div>
    </Drawer>
  );
}
