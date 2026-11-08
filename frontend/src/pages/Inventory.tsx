import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { Balance, Ingredient, Movement } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Field, fieldError, isDecimal, TextField } from "../components/Form";
import { PageHeader } from "../components/PageHeader";
import { ErrorBanner } from "../components/States";
import { ListState, Pager } from "../components/Table";
import { formatDateTime } from "../i18n/format";

type Tab = "balances" | "movements" | "adjust" | "opening";

export function Inventory() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("balances");
  const [adjustFor, setAdjustFor] = useState("");
  return (
    <>
      <PageHeader title={t("nav.inventory")} />
      <div className="tabs" role="tablist">
        {(["balances", "movements", "adjust", "opening"] as Tab[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>{t(`inventory.tabs.${k}`)}</button>
        ))}
      </div>
      {tab === "balances" && <Balances onAdjust={(id) => { setAdjustFor(id); setTab("adjust"); }} />}
      {tab === "movements" && <Movements />}
      {tab === "adjust" && <Adjust initialId={adjustFor} />}
      {tab === "opening" && <Opening />}
    </>
  );
}

const useIngredients = () => useQuery({ queryKey: ["ingredients", "all"], queryFn: () => api.all<Ingredient>("/ingredients", { ordering: "name" }) });

function Balances({ onAdjust }: { onAdjust: (id: string) => void }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [flag, setFlag] = useState("");
  const q = useQuery({
    queryKey: ["balances", page, search, flag],
    queryFn: () => api.list<Balance>("/inventory/balances", { page, search, is_low: flag === "low" ? true : undefined, is_negative: flag === "negative" ? true : undefined }),
  });
  return (
    <div className="card">
      <div className="toolbar">
        <div className="form-group"><label className="form-label">{t("common.search")}</label><input className="form-input" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
        <div className="form-group"><label className="form-label">{t("common.status")}</label>
          <select className="form-select" value={flag} onChange={(e) => { setFlag(e.target.value); setPage(1); }}>
            <option value="">{t("common.all")}</option><option value="low">{t("inventory.low")}</option><option value="negative">{t("inventory.negative")}</option>
          </select></div>
      </div>
      <ListState loading={q.isLoading} error={q.error} empty={q.data?.data.length === 0}>
        <table className="erp-table">
          <thead><tr><th>{t("nav.ingredients")}</th><th className="num">{t("inventory.qty")}</th><th>{t("ingredients.unit")}</th><th className="num">{t("ingredients.threshold")}</th><th /><th /></tr></thead>
          <tbody>
            {q.data?.data.map((b) => (
              <tr key={b.ingredient_id} className={b.is_negative ? "row-negative" : b.is_low ? "row-low" : ""}>
                <td>{b.ingredient_name}</td><td className="num mono">{b.qty}</td><td>{b.base_unit}</td><td className="num mono">{b.low_stock_threshold ?? "—"}</td>
                <td>{b.is_negative ? <span className="badge badge-danger">{t("inventory.negative")}</span> : b.is_low ? <span className="badge badge-pending">{t("inventory.low")}</span> : null}</td>
                <td><div className="row-actions"><button className="btn btn-outline btn-sm" onClick={() => onAdjust(b.ingredient_id)}>{t("inventory.adjust")}</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListState>
      <Pager meta={q.data?.meta} page={page} onPage={setPage} />
    </div>
  );
}

function Movements() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const ings = useIngredients();
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ ingredient_id: "", movement_type: "", from: "", to: "" });
  const q = useQuery({ queryKey: ["movements", page, f], queryFn: () => api.list<Movement>("/inventory/movements", { page, ...f }) });
  const set = (k: string, v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  const tz = me?.settings.timezone ?? "UTC";
  return (
    <div className="card">
      <div className="toolbar">
        <div className="form-group"><label className="form-label">{t("nav.ingredients")}</label>
          <select className="form-select" value={f.ingredient_id} onChange={(e) => set("ingredient_id", e.target.value)}>
            <option value="">{t("common.all")}</option>{ings.data?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">{t("inventory.type")}</label>
          <select className="form-select" value={f.movement_type} onChange={(e) => set("movement_type", e.target.value)}>
            <option value="">{t("common.all")}</option>
            {["opening_balance", "adjustment", "sale", "purchase"].map((m) => <option key={m} value={m}>{t(`inventory.types.${m}`)}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">{t("common.from")}</label><input type="date" className="form-input" value={f.from} onChange={(e) => set("from", e.target.value)} /></div>
        <div className="form-group"><label className="form-label">{t("common.to")}</label><input type="date" className="form-input" value={f.to} onChange={(e) => set("to", e.target.value)} /></div>
      </div>
      <ListState loading={q.isLoading} error={q.error} empty={q.data?.data.length === 0}>
        <table className="erp-table">
          <thead><tr><th>{t("common.date")}</th><th>{t("nav.ingredients")}</th><th>{t("inventory.type")}</th><th className="num">{t("inventory.delta")}</th><th className="num">{t("inventory.balanceAfter")}</th><th>{t("inventory.by")}</th></tr></thead>
          <tbody>
            {q.data?.data.map((m) => (
              <tr key={m.id}>
                <td>{formatDateTime(m.occurred_at, tz)}</td><td>{m.ingredient_name}</td><td>{t(`inventory.types.${m.movement_type}`)}</td>
                <td className="num mono">{m.qty_delta} {m.base_unit}</td><td className="num mono">{m.balance_after}</td><td>{m.created_by_username}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListState>
      <Pager meta={q.data?.meta} page={page} onPage={setPage} />
    </div>
  );
}

function Adjust({ initialId }: { initialId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const ings = useIngredients();
  const [f, setF] = useState({ ingredient_id: initialId, mode: "delta", qty: "", reason: "" });
  const [clientErr, setClientErr] = useState("");
  const [done, setDone] = useState("");
  const save = useMutation({
    mutationFn: () => api.post<{ balance_after: string; qty_delta: string }>("/inventory/adjustments", {
      ingredient_id: f.ingredient_id, mode: f.mode, reason: f.reason,
      ...(f.mode === "delta" ? { qty_delta: f.qty.trim() } : { counted_qty: f.qty.trim() }),
    }),
    onSuccess: (r) => {
      setDone(t("inventory.adjusted", { delta: r.qty_delta, balance: r.balance_after }));
      setF({ ...f, qty: "", reason: "" });
      for (const k of ["balances", "movements"]) void qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const submit = () => {
    setDone("");
    if (!f.ingredient_id) return setClientErr(t("inventory.pickIngredient"));
    if (!isDecimal(f.qty, 3, f.mode === "delta")) return setClientErr(t("common.decimalInvalid"));
    if (!f.reason.trim()) return setClientErr(t("inventory.reasonRequired"));
    setClientErr("");
    save.mutate();
  };
  const unit = ings.data?.find((i) => i.id === f.ingredient_id)?.base_unit ?? "";
  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <ErrorBanner error={save.error} />
      {clientErr && <div className="alert-banner alert-warning" role="alert" style={{ marginBottom: 12 }}>{clientErr}</div>}
      {done && <div className="alert-banner alert-success" role="status" style={{ marginBottom: 12 }}>{done}</div>}
      <Field label={t("nav.ingredients")} error={fieldError(save.error, "ingredient_id")}>
        <select className="form-select" value={f.ingredient_id} onChange={(e) => setF({ ...f, ingredient_id: e.target.value })}>
          <option value="">—</option>{ings.data?.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.base_unit})</option>)}
        </select>
      </Field>
      <Field label={t("inventory.mode")}>
        <select className="form-select" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
          <option value="delta">{t("inventory.modeDelta")}</option><option value="count">{t("inventory.modeCount")}</option>
        </select>
      </Field>
      <TextField label={`${f.mode === "delta" ? t("inventory.deltaQty") : t("inventory.countedQty")} ${unit}`} inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })}
        hint={f.mode === "delta" ? t("inventory.deltaHint") : t("inventory.countHint")} error={fieldError(save.error, "qty_delta") ?? fieldError(save.error, "counted_qty")} />
      <TextField label={t("inventory.reason")} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} error={fieldError(save.error, "reason")} />
      <button className="btn btn-primary" disabled={save.isPending} onClick={submit}>{t("common.save")}</button>
    </div>
  );
}

function Opening() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const ings = useIngredients();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const entries = Object.entries(qty).filter(([, v]) => v.trim() !== "");
  const bad = entries.some(([, v]) => !isDecimal(v, 3) || Number(v) <= 0);
  const save = useMutation({
    mutationFn: () => api.post("/inventory/opening-balances", { items: entries.map(([ingredient_id, v]) => ({ ingredient_id, qty: v.trim() })) }),
    onSuccess: () => {
      setDone(true); setQty({});
      for (const k of ["balances", "movements"]) void qc.invalidateQueries({ queryKey: [k] });
    },
  });
  return (
    <div className="card">
      <div className="alert-banner alert-neutral" style={{ marginBottom: 12 }}>{t("inventory.openingNote")}</div>
      <ErrorBanner error={save.error} />
      {done && <div className="alert-banner alert-success" role="status" style={{ marginBottom: 12 }}>{t("inventory.openingDone")}</div>}
      <ListState loading={ings.isLoading} error={ings.error} empty={ings.data?.length === 0}>
        <table className="erp-table">
          <thead><tr><th>{t("nav.ingredients")}</th><th>{t("ingredients.unit")}</th><th className="num">{t("inventory.qty")}</th></tr></thead>
          <tbody>
            {ings.data?.map((i) => (
              <tr key={i.id}>
                <td>{i.name}</td><td>{i.base_unit}</td>
                <td><input aria-label={i.name} className="form-input inline-input num" inputMode="decimal" value={qty[i.id] ?? ""} onChange={(e) => { setDone(false); setQty({ ...qty, [i.id]: e.target.value }); }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListState>
      {bad && <div className="field-error" role="alert">{t("inventory.openingInvalid")}</div>}
      <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={save.isPending || bad || entries.length === 0} onClick={() => save.mutate()}>{t("common.save")}</button>
    </div>
  );
}
