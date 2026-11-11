import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { Ingredient, ModifierGroup, ModifierOption, OptionEffect, Product } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Check, Field, fieldError, isDecimal, TextField } from "../components/Form";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { Kbd } from "../components/ShortcutsHelp";
import { ErrorBanner, Loading } from "../components/States";
import { ListState, StatusBadge } from "../components/Table";
import { formatMoney } from "../i18n/format";

/** R2: a tracked option with no ingredient effect cannot be sold. */
const noIngredient = (o: ModifierOption) => o.track_stock && (o.effects?.length ?? 0) === 0;

export function Modifiers() {
  const { t } = useTranslation();
  const [editId, setEditId] = useState<string | "new" | null>(null);
  const q = useQuery({ queryKey: ["modifier-groups"], queryFn: () => api.all<ModifierGroup>("/modifier-groups", { ordering: "sort_order" }) });
  return (
    <>
      <PageHeader title={t("nav.modifiers")} subtitle={t("modifiers.help")} actions={<button className="btn btn-primary" data-shortcut="new" onClick={() => setEditId("new")}>{t("common.new")}<Kbd k="N" /></button>} />
      <div className="card">
        <ListState loading={q.isLoading} error={q.error} empty={q.data?.length === 0}>
          <table className="erp-table">
            <thead><tr><th>{t("common.name")}</th><th>{t("modifiers.mode")}</th><th>{t("modifiers.options")}</th><th>{t("modifiers.warnings")}</th><th>{t("common.status")}</th><th /></tr></thead>
            <tbody>
              {q.data?.map((g) => (
                <tr key={g.id}>
                  <td>{g.name}</td>
                  <td>{t(`modifiers.modes.${g.mode}`)}{g.replacement_slot ? ` (${g.replacement_slot})` : ""} · {g.min_select}–{g.max_select}</td>
                  <td>{g.options.map((o) => <span key={o.id} className={`badge ${noIngredient(o) ? "badge-danger" : o.is_active ? "badge-active" : "badge-off"}`} title={noIngredient(o) ? t("modifiers.noIngredientHint") : undefined} style={{ marginInlineEnd: 4 }}>{o.label}{noIngredient(o) ? ` · ${t("modifiers.noIngredient")}` : ""}</span>)}</td>
                  <td>{g.slot_warnings && g.slot_warnings.length > 0 ? <span className="badge badge-danger">{t("modifiers.slotWarnings", { count: g.slot_warnings.length })}</span> : "—"}</td>
                  <td><StatusBadge active={g.is_active} /></td>
                  <td><div className="row-actions"><button className="btn btn-outline btn-sm" onClick={() => setEditId(g.id)}>{t("common.edit")}</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ListState>
      </div>
      {editId && <GroupEditor id={editId} onClose={() => setEditId(null)} />}
    </>
  );
}

function GroupEditor({ id, onClose }: { id: string | "new"; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ["modifier-group", id], enabled: id !== "new", queryFn: () => api.get<ModifierGroup>(`/modifier-groups/${id}`) });
  const [groupId, setGroupId] = useState<string | null>(id === "new" ? null : id);
  const refresh = (g: ModifierGroup) => { setGroupId(g.id); void qc.invalidateQueries({ queryKey: ["modifier-groups"] }); void qc.invalidateQueries({ queryKey: ["modifier-group", g.id] }); };
  if (id !== "new" && !existing.data) return <Modal title={t("modifiers.edit")} onClose={onClose}><Loading /></Modal>;
  return (
    <Modal title={groupId ? t("modifiers.edit") : t("modifiers.new")} onClose={onClose}>
      <GroupFields key={groupId ?? "new"} group={existing.data} onSaved={refresh} />
      {groupId ? <Options groupId={groupId} /> : <p className="form-hint">{t("modifiers.saveFirst")}</p>}
    </Modal>
  );
}

function GroupFields({ group, onSaved }: { group?: ModifierGroup; onSaved: (g: ModifierGroup) => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ name: group?.name ?? "", mode: group?.mode ?? "add", replacement_slot: group?.replacement_slot ?? "", min_select: String(group?.min_select ?? 0), max_select: String(group?.max_select ?? 1), sort_order: String(group?.sort_order ?? 0), is_active: group?.is_active ?? true });
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, mode: f.mode, replacement_slot: f.mode === "replace" ? f.replacement_slot.trim() || null : null, min_select: Number(f.min_select) || 0, max_select: Number(f.max_select) || 1, sort_order: Number(f.sort_order) || 0, is_active: f.is_active };
      return group ? api.patch<ModifierGroup>(`/modifier-groups/${group.id}`, body) : api.post<ModifierGroup>("/modifier-groups", body);
    },
    onSuccess: onSaved,
  });
  const set = (k: string, v: string | boolean) => setF({ ...f, [k]: v });
  return (
    <>
      <ErrorBanner error={save.error} />
      {group?.slot_warnings && group.slot_warnings.length > 0 && (
        <div className="alert-banner alert-warning" role="alert" style={{ marginBottom: 12 }}>
          {t("modifiers.slotWarningsText", { slot: group.replacement_slot })}: {group.slot_warnings.map((w) => `${w.product_name} · ${w.variant_label}`).join(", ")}
        </div>
      )}
      <div className="form-grid">
        <TextField label={t("common.name")} value={f.name} onChange={(e) => set("name", e.target.value)} error={fieldError(save.error, "name")} />
        <Field label={t("modifiers.mode")} error={fieldError(save.error, "mode")}>
          <select className="form-select" value={f.mode} onChange={(e) => set("mode", e.target.value)}>
            <option value="add">{t("modifiers.modes.add")}</option><option value="replace">{t("modifiers.modes.replace")}</option>
          </select>
        </Field>
        {f.mode === "replace" && <TextField label={t("modifiers.slot")} hint={t("modifiers.slotHint")} value={f.replacement_slot} onChange={(e) => set("replacement_slot", e.target.value)} error={fieldError(save.error, "replacement_slot")} />}
        <TextField label={t("modifiers.min")} type="number" min={0} value={f.min_select} onChange={(e) => set("min_select", e.target.value)} error={fieldError(save.error, "min_select")} />
        <TextField label={t("modifiers.max")} type="number" min={1} value={f.max_select} onChange={(e) => set("max_select", e.target.value)} error={fieldError(save.error, "max_select")} />
        <TextField label={t("common.sort")} type="number" value={f.sort_order} onChange={(e) => set("sort_order", e.target.value)} />
      </div>
      <Check label={t("common.active")} checked={f.is_active} onChange={(v) => set("is_active", v)} />
      <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{t("common.save")}</button>
    </>
  );
}

function Options({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const q = useQuery({ queryKey: ["modifier-group", groupId], queryFn: () => api.get<ModifierGroup>(`/modifier-groups/${groupId}`) });
  const [edit, setEdit] = useState<ModifierOption | "new" | null>(null);
  const cur = me?.settings.currency ?? "";
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h4>{t("modifiers.options")}</h4>
        <button className="btn btn-outline btn-sm" onClick={() => setEdit("new")}>{t("modifiers.addOption")}</button>
      </div>
      <div className="table-scroll">
        <table className="erp-table">
          <thead><tr><th>{t("modifiers.label")}</th><th className="num">{t("modifiers.price")}</th><th>{t("modifiers.effectsCount")}</th><th>{t("common.status")}</th><th /></tr></thead>
          <tbody>
            {q.data?.options.map((o) => (
              <tr key={o.id}>
                <td>{o.label}</td><td className="num">{formatMoney(o.price_delta, cur)}{o.variant_prices.length > 0 ? ` (+${o.variant_prices.length})` : ""}</td>
                <td>
                  {!o.track_stock ? <span className="badge badge-off">{t("modifiers.noStockEffectBadge")}</span>
                    : noIngredient(o) ? <span className="badge badge-danger" title={t("modifiers.noIngredientHint")}>{t("modifiers.noIngredient")}</span>
                    : o.effects?.length ?? 0}
                </td><td><StatusBadge active={o.is_active} /></td>
                <td><button className="btn btn-outline btn-sm" onClick={() => setEdit(o)}>{t("common.edit")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <OptionEditor groupId={groupId} option={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

interface PriceRow { key: number; variant_id: string; price_delta: string; }
interface EffRow { key: number; variant_id: string; ingredient_id: string; base_qty: string; waste_pct: string; }
let seq = 0;

function OptionEditor({ groupId, option, onClose }: { groupId: string; option?: ModifierOption; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const products = useQuery({ queryKey: ["products", "all-variants"], queryFn: () => api.all<Product>("/products", { ordering: "name" }) });
  const ings = useQuery({ queryKey: ["ingredients", "active"], queryFn: () => api.all<Ingredient>("/ingredients", { is_active: true, ordering: "name" }) });
  const sizes = (products.data ?? []).flatMap((p) => p.variants.map((v) => ({ id: v.id, label: `${p.name} · ${v.label}` })));
  const [f, setF] = useState({ label: option?.label ?? "", price_delta: option?.price_delta ?? "0.00", sort_order: String(option?.sort_order ?? 0), is_active: option?.is_active ?? true, track_stock: option?.track_stock ?? true });
  const [prices, setPrices] = useState<PriceRow[]>((option?.variant_prices ?? []).map((p) => ({ key: ++seq, ...p })));
  const [effects, setEffects] = useState<EffRow[]>((option?.effects ?? []).map((e: OptionEffect) => ({ key: ++seq, variant_id: e.variant_id ?? "", ingredient_id: e.ingredient_id, base_qty: e.base_qty, waste_pct: e.waste_pct })));
  const [clientErr, setClientErr] = useState("");
  const save = useMutation({
    mutationFn: () => {
      const body = {
        label: f.label.trim(), price_delta: f.price_delta.trim(), sort_order: Number(f.sort_order) || 0, is_active: f.is_active, track_stock: f.track_stock,
        variant_prices: prices.map((p) => ({ variant_id: p.variant_id, price_delta: p.price_delta.trim() })),
        effects: (f.track_stock ? effects : []).map((e) => ({ variant_id: e.variant_id || null, ingredient_id: e.ingredient_id, base_qty: e.base_qty.trim(), waste_pct: e.waste_pct.trim() || "0.00" })),
      };
      return option ? api.patch(`/modifier-options/${option.id}`, body) : api.post(`/modifier-groups/${groupId}/options`, body);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["modifier-group", groupId] }); void qc.invalidateQueries({ queryKey: ["modifier-groups"] }); onClose(); },
  });
  const submit = () => {
    if (!f.label.trim()) return setClientErr(t("modifiers.labelRequired"));
    if (!isDecimal(f.price_delta, 2) || prices.some((p) => !p.variant_id || !isDecimal(p.price_delta, 2))) return setClientErr(t("products.priceInvalid"));
    if (f.track_stock && effects.length === 0) return setClientErr(t("modifiers.effectRequired"));
    if (f.track_stock && effects.some((e) => !e.ingredient_id || !isDecimal(e.base_qty, 3) || !isDecimal(e.waste_pct || "0", 2))) return setClientErr(t("recipe.qtyInvalid"));
    setClientErr("");
    save.mutate();
  };
  const setP = (key: number, patch: Partial<PriceRow>) => setPrices(prices.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const setE = (key: number, patch: Partial<EffRow>) => setEffects(effects.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  return (
    <Modal title={option ? t("modifiers.editOption") : t("modifiers.addOption")} onClose={onClose} footer={<><button className="btn btn-outline" onClick={onClose}>{t("common.cancel")}</button><button className="btn btn-primary" disabled={save.isPending} onClick={submit}>{t("common.save")}</button></>}>
      <ErrorBanner error={save.error} />
      {clientErr && <div className="alert-banner alert-warning" role="alert" style={{ marginBottom: 12 }}>{clientErr}</div>}
      <div className="form-grid">
        <TextField label={t("modifiers.label")} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} error={fieldError(save.error, "label")} />
        <TextField label={t("modifiers.price")} inputMode="decimal" value={f.price_delta} onChange={(e) => setF({ ...f, price_delta: e.target.value })} error={fieldError(save.error, "price_delta")} />
        <TextField label={t("common.sort")} type="number" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} />
      </div>
      <Check label={t("common.active")} checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} />
      <Check label={t("modifiers.noStockEffect")} checked={!f.track_stock} onChange={(v) => setF({ ...f, track_stock: !v })} />
      {fieldError(save.error, "track_stock") && <div className="field-error" role="alert">{fieldError(save.error, "track_stock")}</div>}

      <h4 style={{ margin: "14px 0 6px" }}>{t("modifiers.sizePrices")}</h4>
      <p className="form-hint">{t("modifiers.sizePricesHint")}</p>
      {fieldError(save.error, "variant_prices") && <div className="field-error" role="alert">{fieldError(save.error, "variant_prices")}</div>}
      <div className="table-scroll"><table className="erp-table"><tbody>
        {prices.map((p) => (
          <tr key={p.key}>
            <td><select aria-label={t("modifiers.size")} className="form-select inline-input" value={p.variant_id} onChange={(e) => setP(p.key, { variant_id: e.target.value })}><option value="">—</option>{sizes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></td>
            <td><input aria-label={t("modifiers.price")} className="form-input inline-input num" inputMode="decimal" value={p.price_delta} onChange={(e) => setP(p.key, { price_delta: e.target.value })} /></td>
            <td><button className="btn btn-outline btn-sm" onClick={() => setPrices(prices.filter((x) => x.key !== p.key))}>{t("common.remove")}</button></td>
          </tr>
        ))}
      </tbody></table></div>
      <button className="btn btn-outline btn-sm" onClick={() => setPrices([...prices, { key: ++seq, variant_id: "", price_delta: "" }])}>{t("modifiers.addSizePrice")}</button>

      {f.track_stock && <>
      <h4 style={{ margin: "14px 0 6px" }}>{t("modifiers.effects")}</h4>
      <p className="form-hint">{t("modifiers.effectsHint")}</p>
      {fieldError(save.error, "effects") && <div className="field-error" role="alert">{fieldError(save.error, "effects")}</div>}
      <div className="table-scroll"><table className="erp-table">
        <thead><tr><th>{t("modifiers.size")}</th><th>{t("recipe.ingredient")}</th><th className="num">{t("recipe.baseQty")}</th><th className="num">{t("recipe.waste")}</th><th /></tr></thead>
        <tbody>
          {effects.map((e) => (
            <tr key={e.key}>
              <td><select aria-label={t("modifiers.size")} className="form-select inline-input" value={e.variant_id} onChange={(ev) => setE(e.key, { variant_id: ev.target.value })}><option value="">{t("modifiers.allSizes")}</option>{sizes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></td>
              <td><select aria-label={t("recipe.ingredient")} className="form-select inline-input" value={e.ingredient_id} onChange={(ev) => setE(e.key, { ingredient_id: ev.target.value })}><option value="">—</option>{ings.data?.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.base_unit})</option>)}</select></td>
              <td><input aria-label={t("recipe.baseQty")} className="form-input inline-input num" inputMode="decimal" value={e.base_qty} onChange={(ev) => setE(e.key, { base_qty: ev.target.value })} /></td>
              <td><input aria-label={t("recipe.waste")} className="form-input inline-input num" inputMode="decimal" value={e.waste_pct} onChange={(ev) => setE(e.key, { waste_pct: ev.target.value })} /></td>
              <td><button className="btn btn-outline btn-sm" onClick={() => setEffects(effects.filter((x) => x.key !== e.key))}>{t("common.remove")}</button></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <button className="btn btn-outline btn-sm" onClick={() => setEffects([...effects, { key: ++seq, variant_id: "", ingredient_id: "", base_qty: "", waste_pct: "0.00" }])}>{t("modifiers.addEffect")}</button>
      </>}
    </Modal>
  );
}
