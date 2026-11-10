import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../api/client";
import type { Ingredient, Recipe, RecipeLine, Variant } from "../api/types";
import { isDec, perUnitQty, toUnits } from "../lib/decimal";
import { Modal } from "./Modal";
import { ErrorBanner, Loading } from "./States";

interface Row { key: number; ingredient_id: string; base_qty: string; waste_pct: string; slot_key: string; }
let seq = 0;
const toRow = (l: Partial<RecipeLine>): Row => ({ key: ++seq, ingredient_id: l.ingredient_id ?? "", base_qty: l.base_qty ?? "", waste_pct: l.waste_pct ?? "0.00", slot_key: l.slot_key ?? "" });

export function RecipeEditor({ productName, variant, onClose }: { productName: string; variant: Variant; onClose: () => void }) {
  const { t } = useTranslation();
  const recipe = useQuery({ queryKey: ["recipe", variant.id], queryFn: () => api.get<Recipe>(`/variants/${variant.id}/recipe`) });
  const ings = useQuery({ queryKey: ["ingredients", "active"], queryFn: () => api.all<Ingredient>("/ingredients", { is_active: true, ordering: "name" }) });
  const title = `${t("recipe.title")} · ${productName} · ${variant.label}`;
  if (recipe.isLoading || ings.isLoading || !recipe.data) return <Modal title={title} onClose={onClose}><Loading /></Modal>;
  return <Editor title={title} variantId={variant.id} initial={recipe.data} ingredients={ings.data ?? []} onClose={onClose} />;
}

function Editor({ title, variantId, initial, ingredients, onClose }: { title: string; variantId: string; initial: Recipe; ingredients: Ingredient[]; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[]>(initial.lines.map(toRow));
  const [warnings, setWarnings] = useState(initial.warnings);
  const [clientErr, setClientErr] = useState("");
  const [saved, setSaved] = useState(false);
  const unit = (id: string) => ingredients.find((i) => i.id === id)?.base_unit ?? "";
  const set = (key: number, patch: Partial<Row>) => { setSaved(false); setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r))); };

  const save = useMutation({
    mutationFn: () => api.put<Recipe>(`/variants/${variantId}/recipe`, {
      lines: rows.map((r) => ({ ingredient_id: r.ingredient_id, base_qty: r.base_qty.trim(), waste_pct: r.waste_pct.trim() || "0.00", slot_key: r.slot_key.trim() || null })),
    }),
    onSuccess: (r) => { setWarnings(r.warnings); setSaved(true); void qc.invalidateQueries({ queryKey: ["recipe", variantId] }); void qc.invalidateQueries({ queryKey: ["modifier-groups"] }); },
  });

  const submit = () => {
    for (const r of rows) {
      if (!r.ingredient_id) return setClientErr(t("recipe.pickIngredient"));
      if (!isDec(r.base_qty, 3)) return setClientErr(t("recipe.qtyInvalid"));
      if (!isDec(r.waste_pct || "0", 2) || toUnits(r.waste_pct || "0", 2) > 10000n) return setClientErr(t("recipe.wasteInvalid"));
      if (r.slot_key && !/^[-a-zA-Z0-9_]+$/.test(r.slot_key.trim())) return setClientErr(t("recipe.slotInvalid"));
    }
    setClientErr("");
    save.mutate();
  };

  const problems = save.error instanceof ApiError && save.error.code === "INVALID_RECIPE"
    ? ((save.error.details as { lines?: { index: number; problems: string[] }[] }).lines ?? [])
    : [];

  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn btn-outline" onClick={onClose}>{t("common.close")}</button><button className="btn btn-primary" disabled={save.isPending} onClick={submit}>{t("common.save")}</button></>}>
      <p className="form-hint" style={{ marginBottom: 10 }}>{t("recipe.help")}</p>
      {save.error && problems.length === 0 && <ErrorBanner error={save.error} />}
      {clientErr && <div className="alert-banner alert-warning" role="alert" style={{ marginBottom: 12 }}>{clientErr}</div>}
      {saved && <div className="alert-banner alert-success" role="status" style={{ marginBottom: 12 }}>{t("recipe.saved")}</div>}
      {warnings.map((w) => (
        <div key={w.group_name} className="alert-banner alert-warning" role="alert" style={{ marginBottom: 8 }}>{t("recipe.slotMissing", { group: w.group_name, slot: w.replacement_slot })}</div>
      ))}
      <div className="table-scroll">
        <table className="erp-table">
          <thead><tr><th>{t("recipe.ingredient")}</th><th className="num">{t("recipe.baseQty")}</th><th className="num">{t("recipe.waste")}</th><th>{t("recipe.slot")}</th><th className="num">{t("recipe.perUnit")}</th><th /></tr></thead>
          <tbody>
            {rows.map((r, idx) => {
              const ok = isDec(r.base_qty, 3) && isDec(r.waste_pct || "0", 2);
              const bad = problems.find((p) => p.index === idx);
              return (
                <tr key={r.key}>
                  <td>
                    <select aria-label={t("recipe.ingredient")} className="form-select inline-input" value={r.ingredient_id} onChange={(e) => set(r.key, { ingredient_id: e.target.value })}>
                      <option value="">—</option>
                      {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.base_unit})</option>)}
                    </select>
                    {bad && <div className="field-error" role="alert">{bad.problems.map((p) => t(`recipe.problems.${p}`, { defaultValue: p })).join(", ")}</div>}
                  </td>
                  <td><input aria-label={t("recipe.baseQty")} className="form-input inline-input num" inputMode="decimal" value={r.base_qty} onChange={(e) => set(r.key, { base_qty: e.target.value })} /></td>
                  <td><input aria-label={t("recipe.waste")} className="form-input inline-input num" inputMode="decimal" value={r.waste_pct} onChange={(e) => set(r.key, { waste_pct: e.target.value })} /></td>
                  <td><input aria-label={t("recipe.slot")} className="form-input inline-input" placeholder="milk" value={r.slot_key} onChange={(e) => set(r.key, { slot_key: e.target.value })} /></td>
                  <td className="num mono">{ok ? `${perUnitQty(r.base_qty, r.waste_pct || "0")} ${unit(r.ingredient_id)}` : "—"}</td>
                  <td><button className="btn btn-outline btn-sm" onClick={() => { setSaved(false); setRows(rows.filter((x) => x.key !== r.key)); }}>{t("common.remove")}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="form-hint">{t("recipe.empty")}</p>}
      <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={() => setRows([...rows, toRow({})])}>{t("recipe.addLine")}</button>
    </Modal>
  );
}
