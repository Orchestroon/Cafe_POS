import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { api } from "../api/client";
import type { Balance, Ingredient, Movement } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Drawer } from "../components/Drawer";
import { Field, fieldError, TextField } from "../components/Form";
import { IngredientForm, type IngredientDraft } from "../components/IngredientForm";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { Kbd } from "../components/ShortcutsHelp";
import { ErrorBanner } from "../components/States";
import { ListState, Pager } from "../components/Table";
import { formatDateTime, formatMoney } from "../i18n/format";
import { isDec, normMoney, toUnits } from "../lib/decimal";
import { avgFrom, costPer, readable, toBase, unitsFor, validEntry, type EntryUnit } from "../lib/units";

type Tab = "stock" | "movements";

/** Inventory & Stock (Step 3): one table of every ingredient (quantity, unit, average cost,
 * low-stock threshold) with New / Edit / Adjust-Waste / Opening balances, plus the Movements ledger. */
export function Inventory() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("stock");
  const [form, setForm] = useState<IngredientDraft | null>(null);
  const [adjustFor, setAdjustFor] = useState<string | null>(null); // "" = no ingredient chosen yet
  const [opening, setOpening] = useState(false);
  return (
    <>
      <PageHeader title={t("nav.inventory")} subtitle={t("ingredients.note")} actions={<>
        <button className="btn btn-outline" onClick={() => setOpening(true)}>{t("inventory.tabs.opening")}</button>
        <button className="btn btn-outline" onClick={() => setAdjustFor("")}>{t("inventory.adjustWaste")}</button>
        <button className="btn btn-primary" data-shortcut="new" onClick={() => setForm({ base_unit: "g", is_active: true })}>{t("ingredients.newButton")}<Kbd k="N" /></button>
      </>} />
      <div className="tabs" role="tablist">
        {(["stock", "movements"] as Tab[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab${tab === k ? " active" : ""}`} onClick={() => setTab(k)}>{t(`inventory.tabs.${k}`)}</button>
        ))}
      </div>
      {tab === "stock" && <Stock onEdit={(b) => setForm({ id: b.ingredient_id, name: b.ingredient_name, base_unit: b.base_unit, low_stock_threshold: b.low_stock_threshold, is_active: b.is_active })} onAdjust={(id) => setAdjustFor(id)} />}
      {tab === "movements" && <Movements />}
      {form && <IngredientForm initial={form} onClose={() => setForm(null)} />}
      {adjustFor !== null && <Adjust initialId={adjustFor} onClose={() => setAdjustFor(null)} />}
      {opening && <Drawer title={t("inventory.tabs.opening")} wide onClose={() => setOpening(false)}><Opening /></Drawer>}
    </>
  );
}

const useIngredients = () => useQuery({ queryKey: ["ingredients", "all"], queryFn: () => api.all<Ingredient>("/ingredients", { ordering: "name" }) });

function Stock({ onEdit, onAdjust }: { onEdit: (b: Balance) => void; onAdjust: (id: string) => void }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const cur = me?.settings.currency ?? "";
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  // The status filter lives in the URL so the overview cards and the bell can link straight to it.
  const [params, setParams] = useSearchParams();
  const flag = params.get("flag") ?? "";
  const setFlag = (v: string) => { setPage(1); setParams((p) => { const n = new URLSearchParams(p); if (v) n.set("flag", v); else n.delete("flag"); return n; }, { replace: true }); };
  const q = useQuery({
    queryKey: ["balances", page, search, flag],
    queryFn: () => api.list<Balance>("/inventory/balances", { page, search, is_low: flag === "low" ? true : undefined, is_negative: flag === "negative" ? true : undefined, no_cost: flag === "no-price" ? true : undefined }),
  });
  const perUnit = (avg: string, b: Balance) => { const c = costPer(avg, b.base_unit); return t("reports.perUnit", { cost: formatMoney(c.amount, cur), unit: t(`units.${c.unit}`) }); };
  return (
    <div className="card">
      <div className="toolbar">
        <div className="form-group"><label className="form-label">{t("common.search")}<input data-shortcut="search" className="form-input" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></label></div>
        <div className="form-group"><label className="form-label">{t("common.status")}
          <select className="form-select" value={flag} onChange={(e) => setFlag(e.target.value)}>
            <option value="">{t("common.all")}</option><option value="low">{t("inventory.low")}</option><option value="negative">{t("inventory.negative")}</option><option value="no-price">{t("ingredients.noCost")}</option>
          </select></label></div>
      </div>
      <ListState loading={q.isLoading} error={q.error} empty={q.data?.data.length === 0}>
        <table className="erp-table">
          <thead><tr><th>{t("common.name")}</th><th className="num">{t("inventory.qty")}</th><th>{t("ingredients.unit")}</th><th className="num">{t("ingredients.avgCost")}</th><th className="num">{t("ingredients.threshold")}</th><th /><th /></tr></thead>
          <tbody>
            {q.data?.data.map((b) => (
              <tr key={b.ingredient_id} className={b.is_negative ? "row-negative" : b.is_low ? "row-low" : ""}>
                <td>{b.ingredient_name}{!b.is_active && <span className="badge badge-off" style={{ marginInlineStart: 6 }}>{t("common.inactive")}</span>}</td>
                <td className="num mono">{b.qty}</td><td>{t(`units.${b.base_unit}`)}</td>
                <td className="num mono">{b.unit_cost === null ? <span className="badge badge-lowstock">{t("ingredients.noCost")}</span> : perUnit(b.unit_cost, b)}</td>
                <td className="num mono">{b.low_stock_threshold ?? "—"}</td>
                <td>{b.is_negative ? <span className="badge badge-danger">{t("inventory.negative")}</span> : b.is_low ? <span className="badge badge-pending">{t("inventory.low")}</span> : null}</td>
                <td><div className="row-actions">
                  <button className="btn btn-outline btn-sm" onClick={() => onEdit(b)}>{t("common.edit")}</button>
                  <button className="btn btn-outline btn-sm" onClick={() => onAdjust(b.ingredient_id)}>{t("inventory.adjust")}</button>
                </div></td>
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
            {["opening_balance", "adjustment", "sale", "purchase", "purchase_void", "refund_return"].map((m) => <option key={m} value={m}>{t(`inventory.types.${m}`)}</option>)}
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

/** Adjust / Waste (Sprint 5 L2): an adjustment only takes stock out (a loss); a count fixes the balance. */
function Adjust({ initialId, onClose }: { initialId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const ings = useIngredients();
  const [f, setF] = useState({ ingredient_id: initialId, mode: "delta", qty: "", unit: "g" as EntryUnit, reason: "" });
  const [clientErr, setClientErr] = useState("");
  const [done, setDone] = useState("");
  const ing = ings.data?.find((i) => i.id === f.ingredient_id);
  const units = ing ? unitsFor(ing.base_unit) : [];
  const unit = units.includes(f.unit) ? f.unit : units[0] ?? "g";
  const save = useMutation({
    mutationFn: () => {
      const base = toBase(f.qty.trim(), unit);
      return api.post<{ balance_after: string; qty_delta: string }>("/inventory/adjustments", {
        ingredient_id: f.ingredient_id, mode: f.mode, reason: f.reason,
        ...(f.mode === "delta" ? { qty_delta: `-${base}` } : { counted_qty: base }),
      });
    },
    onSuccess: (r) => {
      setDone(t("inventory.adjusted", { delta: r.qty_delta, balance: r.balance_after }));
      setF({ ...f, qty: "", reason: "" });
      for (const k of ["balances", "movements", "ingredients"]) void qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const submit = () => {
    setDone("");
    if (!f.ingredient_id) return setClientErr(t("inventory.pickIngredient"));
    if (!validEntry(f.qty.trim(), unit) || (f.mode === "delta" && toUnits(toBase(f.qty.trim(), unit), 3) <= 0n)) return setClientErr(t("common.decimalInvalid"));
    if (!f.reason.trim()) return setClientErr(t("inventory.reasonRequired"));
    setClientErr("");
    save.mutate();
  };
  return (
    <Modal title={t("inventory.adjustWaste")} onClose={onClose} footer={<>
      <button className="btn btn-outline" onClick={onClose}>{t("common.close")}</button>
      <button className="btn btn-primary" disabled={save.isPending} onClick={submit}>{t("common.save")}</button>
    </>}>
      <div className="alert-banner alert-warning" role="note" style={{ marginBottom: 12 }}>{t("inventory.addWarning")}</div>
      <ErrorBanner error={save.error} />
      {clientErr && <div className="alert-banner alert-error" role="alert" style={{ marginBottom: 12 }}>{clientErr}</div>}
      {done && <div className="alert-banner alert-success" role="status" style={{ marginBottom: 12 }}>{done}</div>}
      <Field label={t("nav.ingredients")} error={fieldError(save.error, "ingredient_id")}>
        <select className="form-select" value={f.ingredient_id} onChange={(e) => setF({ ...f, ingredient_id: e.target.value })}>
          <option value="">—</option>{ings.data?.map((i) => <option key={i.id} value={i.id}>{i.name} ({t(`units.${i.base_unit}`)})</option>)}
        </select>
      </Field>
      <Field label={t("inventory.mode")}>
        <select className="form-select" value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
          <option value="delta">{t("inventory.modeDelta")}</option><option value="count">{t("inventory.modeCount")}</option>
        </select>
      </Field>
      <div className="form-grid">
        <TextField label={f.mode === "delta" ? t("inventory.deltaQty") : t("inventory.countedQty")} inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })}
          hint={f.mode === "delta" ? t("inventory.deltaHint") : t("inventory.countHint")} error={fieldError(save.error, "qty_delta") ?? fieldError(save.error, "counted_qty")} />
        <Field label={t("ingredients.unit")}>
          <select className="form-select" value={unit} onChange={(e) => setF({ ...f, unit: e.target.value as EntryUnit })}>
            {units.map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}
          </select>
        </Field>
      </div>
      <TextField label={t("inventory.reason")} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} error={fieldError(save.error, "reason")} />
    </Modal>
  );
}

interface OpeningRow { qty: string; unit: EntryUnit; value: string }

/** Sprint 5 L3/Q-E: stock in the café without a purchase (at the start, or a gift / found later),
 * always with its total value, so every gram has a cost. Never profit. */
function Opening() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const ings = useIngredients();
  const [rows, setRows] = useState<Record<string, OpeningRow>>({});
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  const cur = me?.settings.currency ?? "";
  const entries = (ings.data ?? []).filter((i) => rows[i.id]?.qty.trim() || rows[i.id]?.value.trim()).map((i) => ({ ing: i, row: rows[i.id] }));
  const lineOk = (i: Ingredient, r: OpeningRow) => {
    const unit = unitsFor(i.base_unit).includes(r.unit) ? r.unit : unitsFor(i.base_unit)[0];
    return validEntry(r.qty.trim(), unit) && toUnits(toBase(r.qty.trim(), unit), 3) > 0n && isDec(r.value.trim(), 2) && toUnits(r.value.trim()) > 0n;
  };
  const bad = entries.some(({ ing, row }) => !lineOk(ing, row));
  const hasStock = entries.some(({ ing }) => ing.stock_qty !== null && toUnits(ing.stock_qty, 3) !== 0n);
  const save = useMutation({
    mutationFn: () => api.post("/inventory/opening-balances", {
      reason: reason.trim(),
      items: entries.map(({ ing, row }) => {
        const unit = unitsFor(ing.base_unit).includes(row.unit) ? row.unit : unitsFor(ing.base_unit)[0];
        return { ingredient_id: ing.id, qty: toBase(row.qty.trim(), unit), total_value: normMoney(row.value.trim()) };
      }),
    }),
    onSuccess: () => {
      setDone(true); setRows({}); setReason("");
      for (const k of ["balances", "movements", "ingredients"]) void qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const blank: OpeningRow = { qty: "", unit: "g", value: "" };
  const set = (id: string, patch: Partial<OpeningRow>) => { setDone(false); setRows({ ...rows, [id]: { ...blank, ...rows[id], ...patch } }); };
  return (
    <div className="card">
      <div className="alert-banner alert-neutral" style={{ marginBottom: 12 }}>{t("inventory.openingNote")}</div>
      <ErrorBanner error={save.error} />
      {done && <div className="alert-banner alert-success" role="status" style={{ marginBottom: 12 }}>{t("inventory.openingDone")}</div>}
      <ListState loading={ings.isLoading} error={ings.error} empty={ings.data?.length === 0}>
        <div className="table-scroll">
          <table className="erp-table">
            <thead><tr><th>{t("nav.ingredients")}</th><th className="num">{t("ingredients.stock")}</th><th className="num">{t("inventory.qty")}</th><th>{t("ingredients.unit")}</th><th className="num">{t("inventory.totalValue")}</th><th className="num">{t("purchases.unitCost")}</th></tr></thead>
            <tbody>
              {ings.data?.filter((i) => i.is_active).map((i) => {
                const units = unitsFor(i.base_unit);
                const r = rows[i.id] ?? { qty: "", unit: units[0], value: "" };
                const unit = units.includes(r.unit) ? r.unit : units[0];
                const avg = lineOk(i, r) ? avgFrom(normMoney(r.value.trim()), toBase(r.qty.trim(), unit)) : null;
                const per = avg ? costPer(avg, i.base_unit) : null;
                return (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td className="num mono">{i.stock_qty === null ? "—" : `${readable(i.stock_qty, i.base_unit).qty} ${t(`units.${readable(i.stock_qty, i.base_unit).unit}`)}`}</td>
                    <td><input aria-label={`${i.name} ${t("inventory.qty")}`} className="form-input inline-input num" inputMode="decimal" value={r.qty} onChange={(e) => set(i.id, { qty: e.target.value, unit })} /></td>
                    <td><select aria-label={`${i.name} ${t("ingredients.unit")}`} className="form-select" value={unit} onChange={(e) => set(i.id, { unit: e.target.value as EntryUnit })}>{units.map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}</select></td>
                    <td><input aria-label={`${i.name} ${t("inventory.totalValue")}`} className="form-input inline-input num" inputMode="decimal" value={r.value} onChange={(e) => set(i.id, { value: e.target.value, unit })} /></td>
                    <td className="num mono">{per ? t("reports.perUnit", { cost: formatMoney(per.amount, cur), unit: t(`units.${per.unit}`) }) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ListState>
      {bad && <div className="field-error" role="alert">{t("inventory.openingInvalid")}</div>}
      <TextField label={t("inventory.reason")} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} hint={hasStock ? t("inventory.openingReasonNeeded") : t("inventory.openingReasonHint")} error={fieldError(save.error, "reason")} />
      <button className="btn btn-primary" disabled={save.isPending || bad || entries.length === 0 || (hasStock && !reason.trim())} onClick={() => save.mutate()}>{t("common.save")}</button>
    </div>
  );
}
