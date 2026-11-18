import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../api/client";
import type { Ingredient, Unit } from "../api/types";
import { Check, Field, fieldError, isDecimal, TextField } from "../components/Form";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { Kbd } from "../components/ShortcutsHelp";
import { ErrorBanner } from "../components/States";
import { ListState, Pager, StatusBadge } from "../components/Table";
import { useAuth } from "../auth/AuthContext";
import { formatMoney } from "../i18n/format";
import { costPer, readable } from "../lib/units";

export function Ingredients() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Partial<Ingredient> | null>(null);
  const q = useQuery({ queryKey: ["ingredients", page, search], queryFn: () => api.list<Ingredient>("/ingredients", { page, search }) });
  const { me } = useAuth();
  const show = (qty: string, u: Unit) => { const r = readable(qty, u); return `${r.qty} ${t(`units.${r.unit}`)}`; };
  // Sprint 5 L1: the real cost, from purchases and opening balances (never typed here).
  const perUnit = (avg: string, u: Unit) => { const c = costPer(avg, u); return t("reports.perUnit", { cost: formatMoney(c.amount, me?.settings.currency ?? ""), unit: t(`units.${c.unit}`) }); };
  return (
    <>
      <PageHeader title={t("nav.ingredients")} subtitle={t("ingredients.note")} actions={<button className="btn btn-primary" data-shortcut="new" onClick={() => setEditing({ base_unit: "g", is_active: true })}>{t("common.new")}<Kbd k="N" /></button>} />
      <div className="card">
        <div className="toolbar"><div className="form-group"><label className="form-label">{t("common.search")}</label><input data-shortcut="search" className="form-input" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div></div>
        <ListState loading={q.isLoading} error={q.error} empty={q.data?.data.length === 0}>
          <table className="erp-table">
            <thead><tr><th>{t("common.name")}</th><th>{t("ingredients.unit")}</th><th className="num">{t("ingredients.threshold")}</th><th className="num">{t("ingredients.stock")}</th><th className="num">{t("ingredients.avgCost")}</th><th>{t("common.status")}</th><th /></tr></thead>
            <tbody>
              {q.data?.data.map((i) => (
                <tr key={i.id}>
                  <td>{i.name}</td><td>{i.base_unit}</td><td className="num mono">{i.low_stock_threshold ?? "—"}</td>
                  <td className="num mono">{i.stock_qty === null ? "—" : show(i.stock_qty, i.base_unit)}</td>
                  <td className="num mono">{i.avg_cost === null ? <span className="badge badge-lowstock">{t("ingredients.noCost")}</span> : perUnit(i.avg_cost, i.base_unit)}</td>
                  <td><StatusBadge active={i.is_active} /></td>
                  <td><div className="row-actions"><button className="btn btn-outline btn-sm" onClick={() => setEditing(i)}>{t("common.edit")}</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ListState>
        <Pager meta={q.data?.meta} page={page} onPage={setPage} />
      </div>
      {editing && <IngredientForm initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function IngredientForm({ initial, onClose }: { initial: Partial<Ingredient>; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: initial.name ?? "", base_unit: (initial.base_unit ?? "g") as Unit,
    threshold: initial.low_stock_threshold ?? "", is_active: initial.is_active ?? true,
  });
  const [clientErr, setClientErr] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: f.name, is_active: f.is_active,
        low_stock_threshold: f.threshold.trim() === "" ? null : f.threshold.trim(),
      };
      if (!initial.id) body.base_unit = f.base_unit; // create-only
      return initial.id ? api.patch(`/ingredients/${initial.id}`, body) : api.post("/ingredients", body);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["ingredients"] }); void qc.invalidateQueries({ queryKey: ["balances"] }); onClose(); },
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (f.threshold.trim() && !isDecimal(f.threshold, 3)) e.threshold = t("common.decimalInvalid");
    setClientErr(e);
    if (!Object.keys(e).length) save.mutate();
  };
  return (
    <Modal title={initial.id ? t("ingredients.edit") : t("ingredients.new")} onClose={onClose}
      footer={<><button className="btn btn-outline" onClick={onClose}>{t("common.cancel")}</button><button className="btn btn-primary" disabled={save.isPending} onClick={submit}>{t("common.save")}</button></>}>
      <ErrorBanner error={save.error} />
      {save.error instanceof ApiError && save.error.code === "INGREDIENT_IN_USE" && (
        <ul className="form-hint" style={{ marginBottom: 12 }}>{((save.error.details as { used_by?: string[] }).used_by ?? []).map((u) => <li key={u}>{u}</li>)}</ul>
      )}
      <TextField label={t("common.name")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={fieldError(save.error, "name")} autoFocus />
      <Field label={t("ingredients.unit")} hint={initial.id ? t("ingredients.unitLocked") : undefined} error={fieldError(save.error, "base_unit")}>
        <select className="form-select" value={f.base_unit} disabled={!!initial.id} onChange={(e) => setF({ ...f, base_unit: e.target.value as Unit })}>
          {(["g", "ml", "pcs"] as const).map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}
        </select>
      </Field>
      <TextField label={t("ingredients.threshold")} inputMode="decimal" value={f.threshold} onChange={(e) => setF({ ...f, threshold: e.target.value })} error={clientErr.threshold ?? fieldError(save.error, "low_stock_threshold")} />
      <p className="form-hint" style={{ marginBottom: 10 }}>{t("ingredients.costHint")}</p>
      <Check label={t("common.active")} checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} />
    </Modal>
  );
}
